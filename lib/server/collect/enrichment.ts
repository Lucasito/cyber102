import "server-only";
import type { Source } from "@/generated/prisma/client";
import { audit, diffFields } from "../audit";
import { queueDataChange } from "../data-changes";
import { db } from "../db";
import { normalizeTitle } from "../normalize";
import { importVenueLocation } from "../venue-registry";
import { cachedPage, type PageCache } from "./fetch";
import { eventDetails, type EventDetails } from "./details";
import { contentHash, RECHECK_MS } from "./recheck";

const VERSION = "enrich:v1:";
export const ENRICHMENT_PAGES = 10;
export const enrichmentPass = () => ({ urls: new Set<string>(), events: 0, fields: 0, venues: 0, proposals: 0, errors: 0 });
type Pass = ReturnType<typeof enrichmentPass>;
const host = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");
const upcoming = (now: Date) => ({ status: { notIn: ["PAST", "CANCELLED"] as ("PAST" | "CANCELLED")[] }, OR: [{ startsAt: { gte: now } }, { endsAt: { gte: now } }] });

async function supplement(target: { id: string; title: string; startsAt: Date; venueId: string | null }, details: EventDetails, source: Source, url: string, userLogin: string | null, pass: Pass) {
  if (!details.matched) return;
  const eventId = target.id;
  return db.$transaction(async tx => {
    const initial = await tx.event.findUnique({ where: { id: eventId }, select: { venueId: true } });
    if (!initial) return;
    if (initial.venueId) await tx.$queryRaw`SELECT id FROM "Venue" WHERE id = ${initial.venueId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
    const event = await tx.event.findFirst({ where: { id: eventId, ...upcoming(new Date()), venueId: initial.venueId }, include: { venue: { include: { aliases: true, building: true } } } });
    if (!event || event.title !== target.title || event.startsAt.getTime() !== target.startsAt.getTime() || event.venueId !== target.venueId || !await tx.eventSource.count({ where: { eventId, source: source.code, url } })) return;
    const reviews = await tx.dataChange.findMany({ where: { entity: "event", entityId: eventId, status: { in: ["pending", "rejected"] } }, select: { after: true } });
    const blocked = new Set(reviews.flatMap(r => Object.keys(r.after as object)));
    // Поле, которое человек явно очистил, автоматически не восстанавливаем.
    const edits = await Promise.all(["priceMin", "priceMax", "ageLimit"].map(async key => {
      const [last] = await tx.$queryRaw<{ edit: unknown }[]>`SELECT diff -> ${key} AS edit FROM "AuditLog"
        WHERE entity = 'event' AND "entityId" = ${eventId} AND action = 'update' AND "userLogin" IS NOT NULL
          AND diff ? ${key} ORDER BY "createdAt" DESC, id DESC LIMIT 1`;
      return { key, edit: last?.edit };
    }));
    for (const { key, edit } of edits) if (Array.isArray(edit) && edit[1] === null) blocked.add(key);
    const fill: { priceMin?: number; priceMax?: number; ageLimit?: number } = {};
    const proposed: Record<string, unknown> = {};
    if (details.age && !blocked.has("ageLimit")) {
      if (event.ageLimit == null) fill.ageLimit = details.age.value;
      else if (event.ageLimit !== details.age.value) proposed.ageLimit = details.age.value;
    }
    if (details.price && !blocked.has("priceMin") && !blocked.has("priceMax")) {
      const { min, max } = details.price.value;
      const conflict = (event.priceMin != null && event.priceMin !== min) || (event.priceMax != null && max != null && event.priceMax !== max) || (event.priceMax != null && min > event.priceMax);
      if (conflict) Object.assign(proposed, { priceMin: min, ...(max != null ? { priceMax: max } : {}) });
      else {
        if (event.priceMin == null) fill.priceMin = min;
        if (event.priceMax == null && max != null) fill.priceMax = max;
      }
    }
    const diff = diffFields(event, fill, ["priceMin", "priceMax", "ageLimit"]);
    if (diff) {
      await tx.event.update({ where: { id: eventId }, data: { ...fill, verifiedAt: new Date() } });
      await audit({ userLogin, entity: "event", entityId: eventId, action: "enrich", summary: `Автоматически дополнены пустые поля из ${url}`,
        diff: { ...diff, evidence: [null, { url, age: details.age, price: details.price }] } }, tx);
    }
    const change = Object.keys(proposed).length ? await queueDataChange(tx, { entity: "event", entityId: eventId, source: source.code, url, current: event, proposed }) : null;
    let venueChanged = false;
    const venue = event.venue, location = details.location?.value;
    if (venue && location) {
      const names = [{ name: venue.name, city: venue.city }, ...venue.aliases, ...(venue.building ? [venue.building] : [])];
      const same = names.some(n => normalizeTitle(n.name) === normalizeTitle(location.name) && normalizeTitle(n.city) === normalizeTitle(location.city));
      const pending = await tx.dataChange.count({ where: { entity: "venue", entityId: venue.id, status: { in: ["pending", "rejected"] } } });
      if (same && !pending) {
        const updated = await importVenueLocation(tx, venue, location, source.code, url);
        const locationDiff = diffFields(venue, updated, ["address", "lat", "lon", "approx"]);
        if (locationDiff) {
          await audit({ userLogin, entity: "venue", entityId: venue.id, action: "enrich", summary: `Местоположение дополнено из ${url}`, diff: { ...locationDiff, evidence: [null, details.location] } }, tx);
          venueChanged = true;
        }
      }
    }
    await tx.eventSource.updateMany({ where: { eventId, source: source.code, url }, data: { fetchedAt: new Date() } });
    return { fields: Object.keys(fill).length, venueChanged, proposal: !!change };
  }).then(result => {
    if (!result) return;
    if (result.fields) { pass.events++; pass.fields += result.fields; }
    if (result.venueChanged) pass.venues++;
    if (result.proposal) pass.proposals++;
  });
}

/** Общий проход для всех типов источников. Не использует ИИ и не создаёт события или площадки. */
export async function enrichSourceEvents(source: Source, pages: PageCache, pass: Pass, userLogin: string | null, newIds?: string[]) {
  if (newIds && !newIds.length) return;
  const now = new Date();
  const links = await db.eventSource.findMany({ where: { source: source.code, event: { ...upcoming(now),
    ...(newIds ? { id: { in: newIds } } : {}), OR: [
      { priceMin: null }, { ageLimit: null }, { venue: { is: null } },
      { venue: { OR: [{ address: null }, { address: "" }, { lat: null }, { lon: null }, { approx: true }] } },
    ], AND: [{ OR: [{ startsAt: { gte: now } }, { endsAt: { gte: now } }] }],
  } }, include: { event: { select: { id: true, title: true, startsAt: true, venueId: true } } }, orderBy: { event: { startsAt: "asc" } } });
  const groups = new Map<string, typeof links>();
  for (const link of links) {
    try { if (host(link.url) !== host(source.url)) continue; } catch { continue; }
    groups.set(link.url, [...(groups.get(link.url) ?? []), link]);
  }
  const prior = new Map((await db.sourceItem.findMany({ where: { sourceId: source.id, guid: { startsWith: VERSION } } })).map(i => [i.guid, i]));
  const ordered = [...groups].sort((a, b) => {
    const urgency = (group: typeof links) => Math.max(now.getTime(), group[0].event.startsAt.getTime()) <= now.getTime() + 7 * 86_400_000 ? 0 : 1;
    return urgency(a[1]) - urgency(b[1]) || (prior.get(VERSION + contentHash(a[0]))?.checkedAt?.getTime() ?? 0) - (prior.get(VERSION + contentHash(b[0]))?.checkedAt?.getTime() ?? 0) || a[1][0].event.startsAt.getTime() - b[1][0].event.startsAt.getTime();
  });
  for (const [url, group] of ordered) {
    const guid = VERSION + contentHash(url), known = prior.get(guid);
    if (!newIds && known?.checkedAt && now.getTime() - known.checkedAt.getTime() < RECHECK_MS) continue;
    if (!pass.urls.has(url) && pass.urls.size >= ENRICHMENT_PAGES) break;
    pass.urls.add(url);
    try {
      const page = await cachedPage(pages, url);
      if (host(page.finalUrl) !== host(source.url)) throw new Error("перенаправление на другой сайт — автоматическое дополнение пропущено");
      const hash = contentHash([VERSION, page.text, group.map(link => [link.eventId, link.event.title, link.event.startsAt.toISOString()])]);
      let matched = false;
      if (newIds || known?.contentHash !== hash) for (const link of group) {
        const details = eventDetails(page.text, link.event); matched ||= details.matched;
        await supplement(link.event, details, source, url, userLogin, pass);
      }
      const reason = known?.contentHash === hash && !newIds ? "страница не изменилась" : matched ? "явные сведения проверены; пустые поля дополнены, противоречия — в модерации" : "нет однозначного совпадения с событием или явных сведений";
      const data = { title: group[0].event.title.slice(0, 300), link: url, eventId: group.length === 1 ? group[0].eventId : null,
        status: "imported", reason, contentHash: hash, checkedAt: new Date() };
      await db.sourceItem.upsert({ where: { sourceId_guid: { sourceId: source.id, guid } }, create: { sourceId: source.id, guid, ...data }, update: data });
    } catch (e) {
      pass.errors++;
      const data = { link: url, title: group[0].event.title.slice(0, 300), status: "error", reason: `дополнение: ${e instanceof Error ? e.message.slice(0, 300) : "ошибка"}`, checkedAt: new Date() };
      await db.sourceItem.upsert({ where: { sourceId_guid: { sourceId: source.id, guid } }, create: { sourceId: source.id, guid, ...data }, update: data });
    }
  }
}
