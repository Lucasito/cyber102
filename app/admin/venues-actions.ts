"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/server/admin";
import { audit, diffFields } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { geocode, isBashkortostanRegion } from "@/lib/server/geocode";
import { dedupKey, normalizeCity } from "@/lib/server/normalize";
import { addVenueAlias, mergeVenues } from "@/lib/server/venue-registry";
import type { ActionState } from "./actions";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/**
 * Уточнить площадку: город, адрес, координаты. Координаты заданы — точные; иначе — поиск по адресу геокодером
 * (только в Башкортостане). Не нашлось — остаётся центр города с пометкой «адрес уточняется».
 */
export async function saveVenue(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    const id = text(f, "id");
    const v = await db.venue.findUniqueOrThrow({ where: { id } });
    if (text(f, "version") !== v.updatedAt.toISOString()) throw new Error("Площадка уже изменена. Обновите страницу.");
    const city = normalizeCity(text(f, "city").slice(0, 100) || v.city, []);
    const address = text(f, "address").slice(0, 300) || null;
    const locked = f.get("locationLocked") === "on";
    const coords = text(f, "coords");
    const m = coords.match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
    if (coords && !m) throw new Error("Координаты — «широта, долгота», например 54.7230, 55.9446");
    let lat = m ? Number(m[1].replace(",", ".")) : null;
    let lon = m ? Number(m[2].replace(",", ".")) : null;
    if (lat != null && (lat < 51 || lat > 57 || lon! < 53 || lon! > 60.5)) throw new Error("Координаты вне Башкортостана — сначала широта (51–57), потом долгота (53–60)");
    const clash = city !== v.city ? await db.venue.findUnique({ where: { name_city: { name: v.name, city } } }) : null;
    if (clash) throw new Error(`В городе ${city} уже есть площадка «${v.name}» — объединение площадок пока вручную`);
    let how = "координаты заданы вручную";
    if (!coords && address === v.address && city === v.city && !v.approx) { lat = v.lat; lon = v.lon; how = "точные координаты сохранены"; }
    if (lat == null && address) {
      const g = await geocode(`${address}, ${city}, Башкортостан`);
      if (g?.found && isBashkortostanRegion(g.region)) {
        ({ lat, lon } = g);
        how = "координаты найдены по адресу";
      } else how = "по адресу не нашлось — остался центр города";
    }
    const exact = lat != null && lon != null;
    if (locked && !address && !exact) throw new Error("Чтобы защитить местоположение, укажите адрес или точные координаты.");
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Venue" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.venue.findUniqueOrThrow({ where: { id } });
      if (current.updatedAt.getTime() !== v.updatedAt.getTime()) throw new Error("Площадка изменилась во время сохранения. Обновите страницу.");
      if (v.buildingId && (await tx.venue.findUniqueOrThrow({ where: { id: v.buildingId } })).city !== city) throw new Error("Зал и здание должны находиться в одном городе.");
      const saved = await tx.venue.update({ where: { id }, data: { city, address, lat, lon, approx: !exact, geocodedAt: exact ? new Date() : null,
        locationLocked: locked, locationVerifiedAt: locked ? new Date() : null } });
      await addVenueAlias(tx, id, v.name, v.city);
      await addVenueAlias(tx, id, v.name, city);
      const changed = [saved];
      for (const hall of await tx.venue.findMany({ where: { buildingId: id } })) {
        if (hall.locationLocked && hall.city !== city) throw new Error("Сначала проверьте город зала с отдельно защищённым адресом.");
        if (!hall.locationLocked) {
          changed.push(await tx.venue.update({ where: { id: hall.id }, data: { city, address, lat, lon, approx: !exact, geocodedAt: saved.geocodedAt } }));
          await addVenueAlias(tx, hall.id, hall.name, hall.city);
        }
      }
      for (const venue of changed) for (const e of await tx.event.findMany({ where: { venueId: venue.id } })) {
        await tx.event.update({ where: { id: e.id }, data: { dedupKey: dedupKey(e.title, e.startsAt, venue.name, venue.city) } });
      }
      await audit({ userLogin: me.login, action: "update", entity: "venue", entityId: id, summary: `Площадка «${v.name}»: ${city}${address ? `, ${address}` : ""} — ${how}${locked ? "; адрес защищён" : ""}`,
        diff: diffFields(v, saved, ["city", "address", "lat", "lon", "locationLocked"]) }, tx);
    });
    revalidatePath("/", "layout");
    return { ok: true, message: exact ? `Сохранено: ${how}` : "Адрес сохранён и защищён, если включён переключатель. Укажите координаты здания для точной точки на карте." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function addAlias(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    const id = text(f, "id"), name = text(f, "alias").slice(0, 200);
    const v = await db.venue.findUniqueOrThrow({ where: { id } });
    const city = normalizeCity(text(f, "aliasCity").slice(0, 100) || v.city, []);
    await db.$transaction(async (tx) => {
      await addVenueAlias(tx, id, name, city);
      await audit({ userLogin: me.login, action: "update", entity: "venue", entityId: id, summary: `Вариант «${name}» (${city}) → «${v.name}» (${v.city})` }, tx);
    });
    revalidatePath("/", "layout"); return { ok: true, message: "Вариант добавлен. Новые события будут связаны с этой площадкой." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export async function removeAlias(id: string): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    await db.$transaction(async (tx) => {
      const a = await tx.venueAlias.delete({ where: { id } });
      await audit({ userLogin: me.login, action: "update", entity: "venue", entityId: a.venueId, summary: `Удалён вариант «${a.name}» (${a.city})` }, tx);
    });
    revalidatePath("/", "layout"); return { ok: true, message: "Вариант удалён" };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export async function mergeVenueRecords(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    if (f.get("confirmed") !== "on") throw new Error("Подтвердите, что выбраны записи одного здания или одного зала.");
    const n = await db.$transaction((tx) => mergeVenues(tx, text(f, "keepId"), text(f, "dropId"), me.login), { timeout: 20_000 });
    revalidatePath("/", "layout"); return { ok: true, message: `Площадки объединены. Перенесено событий: ${n}. Старые названия сохранены.` };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

export async function setVenueBuilding(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    const id = text(f, "id"), buildingId = text(f, "buildingId") || null;
    await db.$transaction(async (tx) => {
      for (const lockId of [...new Set([id, buildingId].filter((x): x is string => !!x))].sort()) await tx.$queryRaw`SELECT id FROM "Venue" WHERE id = ${lockId} FOR UPDATE`;
      const v = await tx.venue.findUniqueOrThrow({ where: { id } });
      if (buildingId) {
        const b = await tx.venue.findUniqueOrThrow({ where: { id: buildingId } });
        if (b.id === id || b.buildingId || await tx.venue.count({ where: { buildingId: id } })) throw new Error("Зал можно привязать только к отдельному зданию; вложенные здания не поддерживаются.");
        if (v.locationLocked && (v.city !== b.city || v.address !== b.address)) throw new Error("Адрес зала защищён и отличается от здания. Сначала проверьте адрес и отключите отдельную защиту зала.");
        await tx.venue.update({ where: { id }, data: { buildingId, ...(!v.locationLocked ? { city: b.city, address: b.address, lat: b.lat, lon: b.lon, approx: b.approx, geocodedAt: b.geocodedAt } : {}) } });
        await addVenueAlias(tx, id, v.name, v.city);
        for (const e of await tx.event.findMany({ where: { venueId: id } })) await tx.event.update({ where: { id: e.id }, data: { dedupKey: dedupKey(e.title, e.startsAt, v.name, b.city) } });
      } else await tx.venue.update({ where: { id }, data: { buildingId: null } });
      await audit({ userLogin: me.login, action: "update", entity: "venue", entityId: id, summary: `Изменена привязка зала «${v.name}» к зданию`, diff: { buildingId: [v.buildingId, buildingId] } }, tx);
    });
    revalidatePath("/", "layout"); return { ok: true, message: "Привязка к зданию сохранена" };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}
