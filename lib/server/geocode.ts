import "server-only";
import { db } from "./db";
import { errMessage, log } from "./log";
import { normalizeTitle } from "./normalize";

// Геокодирование через Nominatim (OpenStreetMap): бесплатно, без ключа, доступен с сервера.
// Правила Nominatim: не чаще 1 запроса в секунду, понятный User-Agent, без массовых выгрузок — поэтому
// очередь с паузой и кеш в БД (GeoCache): один и тот же адрес не запрашивается повторно.
// Используется для координат площадок и для проверки, что населённый пункт — в Башкортостане.

const URL_BASE = "https://nominatim.openstreetmap.org/search";
const UA = "afisha-rb/1.0 (culture events of Bashkortostan)";
const GAP_MS = 1100;

let last = 0;
let chain: Promise<unknown> = Promise.resolve();

/** Запросы — строго по одному с паузой ≥ 1,1 с (общая очередь процесса). */
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

export type GeoResult = { found: boolean; lat: number | null; lon: number | null; region: string | null; display: string | null };

type NominatimItem = { lat: string; lon: string; display_name: string; address?: { state?: string; region?: string } };

/** Адрес или населённый пункт → координаты и регион. Результат (и «не найдено») кешируется. Сбой сети — null. */
export async function geocode(query: string): Promise<GeoResult | null> {
  const key = normalizeTitle(query).slice(0, 300);
  if (!key) return null;
  const cached = await db.geoCache.findUnique({ where: { query: key } });
  if (cached) return cached;
  try {
    const items = await queued(async () => {
      const u = new URL(URL_BASE);
      u.search = new URLSearchParams({ format: "jsonv2", addressdetails: "1", limit: "1", countrycodes: "ru", "accept-language": "ru", q: query }).toString();
      const res = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      return (await res.json()) as NominatimItem[];
    });
    const hit = items[0];
    const result: GeoResult = hit
      ? { found: true, lat: Number(hit.lat), lon: Number(hit.lon), region: hit.address?.state ?? hit.address?.region ?? null, display: hit.display_name.slice(0, 300) }
      : { found: false, lat: null, lon: null, region: null, display: null };
    await db.geoCache.upsert({ where: { query: key }, create: { query: key, ...result }, update: result });
    return result;
  } catch (e) {
    log("warn", "geocode_failed", { error: errMessage(e) });
    return null;
  }
}

export const isBashkortostanRegion = (region: string | null | undefined) => !!region && /башкорт|bashkort/i.test(region);

/**
 * Населённый пункт в Башкортостане? По геокодеру: true / false; null — не удалось проверить (сеть).
 * Используется импортом, когда пункта нет во встроенном справочнике (сёла).
 */
export async function settlementInBashkortostan(city: string): Promise<boolean | null> {
  const r = await geocode(`${city}, Россия`);
  if (!r) return null;
  if (!r.found) return false;
  return isBashkortostanRegion(r.region);
}

/** Варианты названия площадки для поиска: полное; без зала после запятой; без кавычек; без «государственный», «РБ». */
export function venueNameVariants(name: string): string[] {
  const out = new Set<string>();
  const add = (v: string) => {
    const t = v.replace(/\s+/g, " ").trim();
    if (t.length >= 3) out.add(t);
  };
  // В JS \b не работает с кириллицей — границы слов задаём явно: (^|\s) … (?=\s|$)
  const drop = (s: string, words: string) => s.replace(new RegExp(`(^|\\s)(${words})(?=\\s|$)`, "gi"), " ");
  add(name);
  const main = name.split(/,\s*/)[0];
  add(main); // «Театр оперы и балета, Большой зал» → «Театр оперы и балета»
  const plain = main.replace(/[«»"“”„()]/g, " ");
  add(plain);
  add(main.replace(/драмтеатр/gi, "драматический театр"));
  // «Государственный академический …», «… Республики Башкортостан», «… РБ», «имени Х. Ахметова» мешают поиску
  const bare = drop(drop(plain, "государственн\\S*|академическ\\S*|республиканск\\S*|муниципальн\\S*|рб"), "республики\\s+башкортостан")
    .replace(/(^|\s)(имени|им\.)\s+(\S+\s*){1,3}$/i, " ");
  add(bare);
  return [...out].slice(0, 6);
}

/**
 * Фоновая задача: координаты площадкам без них — по адресу, иначе по вариантам названия площадки в городе.
 * Не нашлось — центр населённого пункта с пометкой approx: событие видно на карте («адрес уточняется»), но маршрут
 * не предлагается, поиск «рядом» и переезды в планировщике такие координаты не используют.
 * За проход — не больше limit площадок (каждая — до 7 запросов по 1,1 с; ответы кешируются).
 */
export async function geocodeVenues(limit = 5) {
  // Без координат — и примерные (центр города), у которых появился адрес: адрес в админке сбрасывает geocodedAt
  const venues = await db.venue.findMany({ where: { geocodedAt: null, OR: [{ lat: null }, { approx: true, address: { not: null } }] }, take: limit });
  let found = 0;
  for (const v of venues) {
    if (v.locationLocked && !v.approx && v.lat != null && v.lon != null) continue;
    const building = v.buildingId && !v.locationLocked ? await db.venue.findUnique({ where: { id: v.buildingId } }) : null;
    if (building && !building.approx && building.lat != null && building.lon != null) {
      await db.venue.updateMany({ where: { id: v.id, updatedAt: v.updatedAt }, data: { address: building.address, city: building.city, lat: building.lat, lon: building.lon, approx: false, geocodedAt: new Date() } });
      found++; continue;
    }
    const locked = v.locationLocked || !!building?.locationLocked;
    const queries = [
      v.address ? `${v.address}, ${v.city}, Башкортостан` : null,
      ...(!locked ? venueNameVariants(v.name).map((n) => `${n}, ${v.city}, Башкортостан`) : []),
    ].filter(Boolean) as string[];
    let hit: GeoResult | null = null;
    for (const q of queries) {
      const r = await geocode(q);
      if (r === null) return found; // сеть недоступна — попробуем в следующий раз, не помечая площадку
      if (r.found && isBashkortostanRegion(r.region)) {
        hit = r;
        break;
      }
    }
    let approx = false;
    if (!hit && v.approx) {
      // Был центр города, по адресу не нашлось — оставляем как есть, второй раз не ищем
      await db.venue.updateMany({ where: { id: v.id, updatedAt: v.updatedAt }, data: { geocodedAt: new Date() } });
      continue;
    }
    if (!hit && !locked) {
      const c = await geocode(`${v.city}, Башкортостан`);
      if (c === null) return found;
      if (c.found && isBashkortostanRegion(c.region)) {
        hit = c;
        approx = true;
      }
    }
    await db.venue.updateMany({ where: { id: v.id, updatedAt: v.updatedAt }, data: { geocodedAt: new Date(), ...(hit ? { lat: hit.lat, lon: hit.lon, approx } : {}) } });
    if (hit && !approx) found++;
  }
  if (venues.length) log("info", "geocode_venues", { checked: venues.length, found });
  return found;
}
