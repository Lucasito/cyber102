import "server-only";
import type { Prisma, Venue } from "@/generated/prisma/client";
import { normalizeTitle } from "./normalize";
import { queueDataChange } from "./data-changes";
import { audit } from "./audit";
import { dedupKey } from "./normalize";
import { mergeEventsInTransaction } from "./dedup";

export async function addVenueAlias(tx: Prisma.TransactionClient, venueId: string, name: string, city: string) {
  const key = normalizeTitle(name), cityKey = normalizeTitle(city);
  if (!key || !cityKey) throw new Error("Укажите название и город варианта площадки.");
  const existing = await tx.venueAlias.findUnique({ where: { key_cityKey: { key, cityKey } } });
  if (existing && existing.venueId !== venueId) throw new Error(`Название «${name}» в городе ${city} уже связано с другой площадкой.`);
  // Нельзя перехватить существующую площадку, не объединив её явно.
  const named = await tx.venue.findMany({ where: { city: { equals: city, mode: "insensitive" } }, select: { id: true, name: true } });
  if (named.some((v) => v.id !== venueId && normalizeTitle(v.name) === key)) throw new Error("Площадка с таким названием уже есть. Сначала объедините записи.");
  return tx.venueAlias.upsert({ where: { key_cityKey: { key, cityKey } }, create: { venueId, name, key, city, cityKey }, update: {} });
}

/** Только явные варианты названий. Нечёткое совпадение не объединяет разные здания. */
export async function findVenue(tx: Prisma.TransactionClient, name: string, city: string): Promise<Venue | null> {
  const alias = await tx.venueAlias.findUnique({ where: { key_cityKey: { key: normalizeTitle(name), cityKey: normalizeTitle(city) } }, include: { venue: true } });
  if (alias) return alias.venue;
  const candidates = (await tx.venue.findMany({ where: { city: { equals: city, mode: "insensitive" } } })).filter((v) => normalizeTitle(v.name) === normalizeTitle(name));
  if (candidates.length > 1) throw new Error("Неоднозначное название площадки — объедините варианты в справочнике.");
  return candidates[0] ?? null;
}

export async function resolveVenue(tx: Prisma.TransactionClient, name: string, city: string) {
  let venue = await findVenue(tx, name, city);
  if (!venue) {
    const comma = name.indexOf(",");
    const base = comma > 0 ? await findVenue(tx, name.slice(0, comma).trim(), city) : null;
    const building = base ? (base.buildingId ? await tx.venue.findUniqueOrThrow({ where: { id: base.buildingId } }) : base) : null;
    const canonicalName = building ? `${building.name}, ${name.slice(comma + 1).trim()}` : name;
    venue = building ? await findVenue(tx, canonicalName, building.city) : null;
    venue ??= await tx.venue.create({ data: { name: canonicalName, city: building?.city ?? city,
      ...(building ? { buildingId: building.id, address: building.address, lat: building.lat, lon: building.lon, approx: building.approx, geocodedAt: building.geocodedAt } : {}),
    } });
    if (building && !venue.buildingId) venue = await tx.venue.update({ where: { id: venue.id }, data: { buildingId: building.id } });
  }
  await addVenueAlias(tx, venue.id, name, city);
  return venue;
}

/** Все автоматические записи адреса проходят через защиту модератора, в том числе для залов здания. */
export async function importVenueLocation(tx: Prisma.TransactionClient, venue: Venue, incoming: { address?: string | null; lat?: number | null; lon?: number | null }, source: string, url?: string | null) {
  await tx.$queryRaw`SELECT id FROM "Venue" WHERE id = ${venue.id} FOR UPDATE`;
  const current = await tx.venue.findUniqueOrThrow({ where: { id: venue.id } });
  const building = current.buildingId ? await tx.venue.findUniqueOrThrow({ where: { id: current.buildingId } }) : null;
  const locked = current.locationLocked || building?.locationLocked;
  const proposed: Record<string, unknown> = {};
  if (incoming.address && normalizeTitle(incoming.address) !== normalizeTitle(current.address ?? "")) proposed.address = incoming.address;
  if (incoming.lat != null && incoming.lon != null && incoming.lat >= 51 && incoming.lat <= 57 && incoming.lon >= 53 && incoming.lon <= 60.5 &&
    (current.approx || current.lat == null || current.lon == null || Math.abs(incoming.lat - current.lat) > 0.0002 || Math.abs(incoming.lon - current.lon) > 0.0002)) {
    Object.assign(proposed, { lat: incoming.lat, lon: incoming.lon, approx: false });
  }
  if (locked) {
    if (Object.keys(proposed).length) await queueDataChange(tx, { entity: "venue", entityId: current.id, source, url, current, proposed });
    return current;
  }
  const fill: Prisma.VenueUpdateInput = {
    ...(!current.address && incoming.address ? { address: incoming.address, ...(current.approx ? { geocodedAt: null } : {}) } : {}),
    ...((current.lat == null || current.approx) && proposed.lat != null ? { lat: proposed.lat as number, lon: proposed.lon as number, approx: false } : {}),
  };
  return Object.keys(fill).length ? tx.venue.update({ where: { id: current.id }, data: fill }) : current;
}

/** Модератор явно выбрал, что это одно здание/один зал. Сохраняем события, источники и старые названия. */
export async function mergeVenues(tx: Prisma.TransactionClient, keepId: string, dropId: string, userLogin: string) {
  if (keepId === dropId) throw new Error("Выберите две разные площадки.");
  const ids = [keepId, dropId].sort();
  for (const id of ids) await tx.$queryRaw`SELECT id FROM "Venue" WHERE id = ${id} FOR UPDATE`;
  const keep = await tx.venue.findUniqueOrThrow({ where: { id: keepId } });
  const drop = await tx.venue.findUniqueOrThrow({ where: { id: dropId } });
  if ((keep.buildingId || null) !== (drop.buildingId || null)) throw new Error("Можно объединить два здания или два зала одного здания. Сначала проверьте привязку залов.");
  const events = await tx.event.findMany({ where: { venueId: drop.id } });
  for (const e of events) {
    const key = dedupKey(e.title, e.startsAt, keep.name, keep.city);
    const duplicate = await tx.event.findUnique({ where: { dedupKey: key } });
    if (duplicate && duplicate.id !== e.id) {
      await mergeEventsInTransaction(tx, duplicate.id, e.id);
      await audit({ userLogin, action: "merge", entity: "event", entityId: duplicate.id, summary: `Объединены сеансы при объединении площадок: «${e.title}»` }, tx);
    } else await tx.event.update({ where: { id: e.id }, data: { venueId: keep.id, dedupKey: key } });
  }
  await tx.venueAlias.updateMany({ where: { venueId: drop.id }, data: { venueId: keep.id } });
  await tx.venue.updateMany({ where: { buildingId: drop.id }, data: { buildingId: keep.id } });
  await tx.dataChange.updateMany({ where: { entity: "venue", entityId: drop.id, status: "pending" }, data: { status: "superseded" } });
  await tx.venue.delete({ where: { id: drop.id } });
  await addVenueAlias(tx, keep.id, drop.name, drop.city);
  await addVenueAlias(tx, keep.id, keep.name, keep.city);
  await audit({ userLogin, action: "merge", entity: "venue", entityId: keep.id, summary: `«${drop.name}» (${drop.city}) объединена с «${keep.name}» (${keep.city}); перенесено событий: ${events.length}`,
    diff: { mergedVenue: [drop, keep.id] } }, tx);
  return events.length;
}
