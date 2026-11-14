import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "./audit";
import { db } from "./db";
import { dedupKey, normalizeTitle } from "./normalize";

export const CHANGE_LABELS: Record<string, string> = {
  title: "Название", description: "Описание", startsAt: "Начало", endsAt: "Окончание", durationMin: "Длительность",
  status: "Статус", priceMin: "Цена от", priceMax: "Цена до", ageLimit: "Возраст", categoryId: "Категория",
  venueId: "Площадка", tags: "Метки", language: "Язык", orgUrl: "Организатор", ticketUrl: "Билеты", imageUrl: "Изображение",
  pushkinCard: "Пушкинская карта", city: "Город", address: "Адрес", lat: "Широта", lon: "Долгота", approx: "Примерное местоположение",
};
const nullableText = z.string().nullable();
const eventPatch = z.object({
  title: z.string().min(3).max(300), description: nullableText, startsAt: z.string().datetime(), endsAt: z.string().datetime().nullable(),
  durationMin: z.number().int().positive().nullable(), status: z.enum(["SCHEDULED", "RESCHEDULED", "CANCELLED", "SOLD_OUT", "PAST"]),
  priceMin: z.number().int().nonnegative().nullable(), priceMax: z.number().int().nonnegative().nullable(), ageLimit: z.number().int().nonnegative().nullable(),
  categoryId: nullableText, venueId: nullableText, tags: z.array(z.string()), language: nullableText,
  orgUrl: z.string().url().nullable(), ticketUrl: z.string().url().nullable(), imageUrl: z.string().url().nullable(), pushkinCard: z.boolean(),
}).partial().strict();
const venuePatch = z.object({ city: z.string().min(1).max(100), address: z.string().max(300).nullable(), lat: z.number().min(51).max(57).nullable(), lon: z.number().min(53).max(60.5).nullable(), approx: z.boolean() }).partial().strict();
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonObject;

/** Одно и то же предложение (включая отклонённое) не возникает заново при каждом сборе. */
export async function queueDataChange(tx: Prisma.TransactionClient, args: {
  entity: "event" | "venue"; entityId: string; source: string; url?: string | null;
  current: Record<string, unknown>; proposed: Record<string, unknown>;
}) {
  const proposed = json(args.proposed);
  (args.entity === "event" ? eventPatch : venuePatch).parse(proposed);
  const current = json(args.current);
  const keys = Object.keys(proposed).sort().filter((k) => JSON.stringify(current[k] ?? null) !== JSON.stringify(proposed[k] ?? null));
  if (!keys.length) return null;
  const before = Object.fromEntries(keys.map((k) => [k, current[k] ?? null]));
  const after = Object.fromEntries(keys.map((k) => [k, proposed[k] ?? null]));
  const fingerprint = createHash("sha256").update(JSON.stringify([args.entity, args.entityId, args.source, before, after])).digest("hex");
  return tx.dataChange.upsert({
    where: { fingerprint }, update: {},
    create: { entity: args.entity, entityId: args.entityId, source: args.source, url: args.url, before: json(before), after: json(after), fingerprint },
  });
}

/** Применяем только показанные поля и только если они не были изменены после создания предложения. */
export async function reviewDataChange(id: string, accept: boolean, userLogin: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "DataChange" WHERE id = ${id} FOR UPDATE`;
    const change = await tx.dataChange.findUniqueOrThrow({ where: { id } });
    if (change.status !== "pending") throw new Error("Это изменение уже рассмотрено.");
    if (accept) {
      const before = change.before as Record<string, unknown>;
      const after = change.after as Record<string, unknown>;
      if (change.entity === "event") await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${change.entityId} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM "Venue" WHERE id = ${change.entityId} FOR UPDATE`;
      const current = change.entity === "event"
        ? await tx.event.findUniqueOrThrow({ where: { id: change.entityId } })
        : await tx.venue.findUniqueOrThrow({ where: { id: change.entityId } });
      const values = json(current);
      if (Object.keys(after).some((k) => JSON.stringify(values[k] ?? null) !== JSON.stringify(before[k] ?? null))) {
        throw new Error("Карточка уже изменена. Сверьте текущее состояние и отклоните устаревшее предложение.");
      }
      if (change.entity === "event") {
        const patch = eventPatch.parse(after);
        const old = await tx.event.findUniqueOrThrow({ where: { id: change.entityId } });
        const startsAt = patch.startsAt ? new Date(patch.startsAt) : old.startsAt;
        const endsAt = patch.endsAt === undefined ? old.endsAt : patch.endsAt ? new Date(patch.endsAt) : null;
        if (endsAt && endsAt < startsAt) throw new Error("Окончание раньше начала.");
        const min = patch.priceMin === undefined ? old.priceMin : patch.priceMin;
        const max = patch.priceMax === undefined ? old.priceMax : patch.priceMax;
        if (min != null && max != null && min > max) throw new Error("Цена «от» больше цены «до».");
        const venueId = patch.venueId === undefined ? old.venueId : patch.venueId;
        const venue = venueId ? await tx.venue.findUniqueOrThrow({ where: { id: venueId } }) : null;
        const moved = startsAt.getTime() !== old.startsAt.getTime();
        await tx.event.update({ where: { id: old.id }, data: {
          ...patch, startsAt, endsAt, normalizedTitle: normalizeTitle(patch.title ?? old.title),
          dedupKey: dedupKey(patch.title ?? old.title, startsAt, venue?.name, venue?.city),
          ...(moved ? { originalStartsAt: old.originalStartsAt ?? old.startsAt, status: patch.status === "CANCELLED" ? "CANCELLED" : "RESCHEDULED" } : {}),
          verifiedAt: new Date(),
        } });
        if (moved || patch.status === "CANCELLED") {
          await tx.reminder.updateMany({ where: { eventId: old.id, sentAt: null }, data: { remindAt: new Date() } });
        }
      } else {
        const patch = venuePatch.parse(after);
        await tx.venue.update({ where: { id: change.entityId }, data: { ...patch, locationLocked: true, locationVerifiedAt: new Date(), geocodedAt: new Date() } });
        // Залы используют адрес своего здания; защищённый отдельно зал не меняем.
        await tx.venue.updateMany({ where: { buildingId: change.entityId, locationLocked: false }, data: patch });
      }
    }
    await tx.dataChange.update({ where: { id }, data: { status: accept ? "accepted" : "rejected", reviewedBy: userLogin, reviewedAt: new Date() } });
    await audit({ userLogin, action: accept ? "approve" : "reject", entity: change.entity === "event" ? "event" : "venue", entityId: change.entityId,
      summary: `${accept ? "Принято" : "Отклонено"} изменение из источника «${change.source}»`,
      diff: Object.fromEntries(Object.keys(change.after as object).map((k) => [k, [(change.before as Record<string, unknown>)[k], (change.after as Record<string, unknown>)[k]]])),
    }, tx);
    return accept ? "Изменение принято" : "Изменение отклонено";
  });
}
