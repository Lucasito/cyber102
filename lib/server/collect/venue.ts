import "server-only";
import type { Source } from "@/generated/prisma/client";
import { db } from "../db";
import { geocode, isBashkortostanRegion } from "../geocode";
import { normalizeTitle, RB_SETTLEMENTS } from "../normalize";
import { importVenueLocation } from "../venue-registry";

// Площадка источника и город из названия площадки — до импорта, чтобы у событий были точные адрес и координаты.

type Row = Record<string, unknown>;

/** Общие слова названий площадок: по ним здания не различить (город в названии — тоже). */
const GENERIC = new Set(["театр", "зал", "им", "имени", "государственный", "государственная", "академический", "академическая", "республики", "республиканский", "башкортостан", "башкортостана", "рб", "большой", "малый", "сцена", "камерная", "г", "город", "гау", "мбу", "мбук", "гбук", "гбуки"]);
const CITY_WORDS = new Set(RB_SETTLEMENTS.map((c) => normalizeTitle(c)));
const words = (name: string) =>
  normalizeTitle(name.split(",")[0])
    .split(" ")
    .filter((w) => w.length > 1 && !GENERIC.has(w) && !CITY_WORDS.has(w) && ![...CITY_WORDS].some((c) => w.startsWith(c.slice(0, Math.max(5, c.length - 2)))))
    .map((w) => w.slice(0, 4)); // «драмтеатр» и «драматический» → «драм»

/**
 * Та же ли это площадка, что у источника: все значимые слова короткого названия есть в длинном. Общие слова и город
 * не считаются, а «башкирский» / «русский» — считаются: «Башкирский драмтеатр» ≠ «Русский драмтеатр Стерлитамака».
 */
export function sameBuilding(venue: string, sourceVenue: string) {
  const a = words(venue);
  const b = words(sourceVenue);
  if (!a.length || !b.length) return normalizeTitle(venue) === normalizeTitle(sourceVenue);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((w) => long.includes(w));
}

/** Город, названный в названии площадки: «ГДК Стерлитамак», «МБУК „ГДК“ г. Сибай» → Стерлитамак, Сибай. */
export function cityInVenue(venue: string): string | null {
  const t = ` ${normalizeTitle(venue)} `;
  // Длинные названия — первыми: «Октябрьский» не путать с «Октябрьский район», но и не искать «Уфа» внутри других слов
  for (const city of [...RB_SETTLEMENTS].sort((a, b) => b.length - a.length)) {
    if (t.includes(` ${normalizeTitle(city)} `)) return city;
  }
  return null;
}

/**
 * Подготовка строк источника:
 *  • площадка источника (все события в одном здании): запись без площадки или с похожим названием — к ней;
 *    зал после запятой сохраняется («Театр „Нур“, Малый зал»), адрес и координаты — из источника;
 *  • город из названия площадки главнее города источника по умолчанию («ГДК Стерлитамак» у источника про Уфу).
 */
export function prepareRows(source: Pick<Source, "city" | "venueName" | "venueAddress" | "venueLat" | "venueLon">, rows: Row[]): Row[] {
  return rows.map((r) => {
    const out = { ...r };
    const venue = typeof r.venue === "string" ? r.venue.trim() : "";
    if (source.venueName && (!venue || sameBuilding(venue, source.venueName))) {
      const hall = venue.includes(",") ? venue.split(",").slice(1).join(",").trim() : "";
      out.venue = hall ? `${source.venueName}, ${hall}` : source.venueName;
      if (!out.address && source.venueAddress) out.address = source.venueAddress;
      if (source.venueLat != null && source.venueLon != null) Object.assign(out, { lat: source.venueLat, lon: source.venueLon });
      if (!out.city && source.city) out.city = source.city;
      return out;
    }
    const named = venue ? cityInVenue(venue) : null;
    if (named) out.city = named;
    return out;
  });
}

/**
 * Координаты площадок источника: площадки его города с похожим названием получают адрес и точные координаты
 * (из источника или по адресу через геокодер). Вызывается при сохранении источника и после сбора.
 */
export async function applySourceVenue(source: Pick<Source, "city" | "venueName" | "venueAddress" | "venueLat" | "venueLon">) {
  if (!source.venueName) return 0;
  let lat = source.venueLat;
  let lon = source.venueLon;
  if ((lat == null || lon == null) && source.venueAddress) {
    const g = await geocode(`${source.venueAddress}${source.city ? `, ${source.city}` : ""}, Башкортостан`);
    if (g?.found && isBashkortostanRegion(g.region)) ({ lat, lon } = g);
  }
  const venues = await db.venue.findMany({ where: source.city ? { city: { equals: source.city, mode: "insensitive" } } : {} });
  let n = 0;
  for (const v of venues) {
    if (!sameBuilding(v.name, source.venueName)) continue;
    await db.$transaction((tx) => importVenueLocation(tx, v, { address: source.venueAddress, lat, lon }, `площадка источника: ${source.venueName}`));
    n++;
  }
  return n;
}
