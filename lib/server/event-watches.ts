import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { formatPrice, TZ } from "../format";
import { db } from "./db";
import { errMessage, log } from "./log";

export const MAX_EVENT_WATCHES = 100;
const watchInclude = { venue: true } as const;
type WatchedEvent = Prisma.EventGetPayload<{ include: typeof watchInclude }>;

export function watchState(e: WatchedEvent) {
  // Не сохраняем закрытые сведения из черновиков в снимке подписки.
  if (e.publication !== "PUBLISHED") return { publication: "DRAFT" };
  return { publication: e.publication, title: e.title, status: e.status, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString() ?? null,
    venueId: e.venueId, venue: e.venue?.name ?? null, city: e.venue?.city ?? null, address: e.venue?.address ?? null, priceMin: e.priceMin, priceMax: e.priceMax };
}

export async function subscribeToEvent(botUserId: string, eventId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "BotUser" WHERE id = ${botUserId} FOR UPDATE`;
    const event = await tx.event.findFirst({ where: { id: eventId, publication: "PUBLISHED" }, include: watchInclude });
    if (!event || event.status === "PAST" || (event.endsAt ?? event.startsAt) < new Date()) throw new Error("Событие больше не доступно для отслеживания.");
    const old = await tx.eventWatch.findUnique({ where: { botUserId_eventId: { botUserId, eventId } } });
    if (old) return { event, existing: true };
    if (await tx.eventWatch.count({ where: { botUserId } }) >= MAX_EVENT_WATCHES) throw new Error("Можно отслеживать до 100 событий. Удалите ненужные подписки командой /watches.");
    await tx.eventWatch.create({ data: { botUserId, eventId, lastState: watchState(event) as Prisma.InputJsonObject } });
    return { event, existing: false };
  });
}

const labels: Record<string, string> = { title: "название", status: "статус", startsAt: "дата и время", endsAt: "окончание", venueId: "площадка", venue: "площадка", city: "город", address: "адрес", priceMin: "цена", priceMax: "цена", publication: "публикация" };
export type WatchSender = (platform: string, externalId: string, text: string, links: { title: string; url: string }[]) => Promise<boolean>;

/** По 50 подписок с самой старой проверкой; повторная отправка при сбое, снимок меняется только после успеха. */
export async function sendEventWatchUpdates(send: WatchSender) {
  const watches = await db.eventWatch.findMany({ orderBy: [{ checkedAt: "asc" }, { id: "asc" }], take: 50, include: { botUser: true, event: { include: watchInclude } } });
  let sent = 0;
  for (const w of watches) {
    const checkedAt = new Date(Math.max(Date.now(), w.checkedAt.getTime() + 1));
    const claim = await db.eventWatch.updateMany({ where: { id: w.id, checkedAt: w.checkedAt }, data: { checkedAt } });
    if (!claim.count) continue;
    const state = watchState(w.event) as Record<string, unknown>, before = w.lastState as Record<string, unknown>;
    const changed = [...new Set([...Object.keys(before), ...Object.keys(state)])].filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(state[key] ?? null));
    if (!changed.length) continue;
    // Окончание события само по себе не повод присылать уведомление.
    if (changed.length === 1 && changed[0] === "status" && state.status === "PAST") {
      await db.eventWatch.updateMany({ where: { id: w.id, checkedAt }, data: { lastState: state as Prisma.InputJsonObject } }); continue;
    }
    const e = w.event, publicEvent = e.publication === "PUBLISHED";
    const base = process.env.PUBLIC_URL ?? "";
    const summary = [...new Set(changed.map((key) => labels[key]).filter(Boolean))].join(", ");
    const text = publicEvent ? [e.status === "CANCELLED" ? `«${e.title}» отменено.` : `Изменилось сохранённое событие «${e.title}».`,
      `Обновлено: ${summary}.`, e.startsAt.toLocaleString("ru-RU", { timeZone: TZ, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }),
      [e.venue?.name, e.venue?.city, e.venue?.address].filter(Boolean).join(", "), formatPrice(e), "Управление подписками — /watches."].filter(Boolean).join("\n")
      : "Сохранённое событие больше не опубликовано. Его сведения можно уточнить у организатора. Управление подписками — /watches.";
    try {
      const delivered = await send(w.botUser.platform, w.botUser.externalId, text, [{ title: publicEvent ? e.title : "Афиша", url: publicEvent ? `${base}/events/${e.id}` : base || "/" }]);
      if (delivered) { await db.eventWatch.updateMany({ where: { id: w.id, checkedAt }, data: { lastState: state as Prisma.InputJsonObject } }); sent++; }
    } catch (e) { log("warn", "event_watch_failed", { watchId: w.id, error: errMessage(e) }); }
  }
  return sent;
}
