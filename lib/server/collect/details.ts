import "server-only";
import { normalizeTitle, parseDate } from "../normalize";
import { decodeEntities, htmlToText } from "./fetch";
import { jsonLdAge, jsonLdDetails, jsonLdPrice } from "./jsonld";

type Row = Record<string, unknown>;
type Evidence<T> = { value: T; quote: string; method: "schema.org" | "text" };
export type EventDetails = {
  matched: boolean;
  age?: Evidence<number>;
  price?: Evidence<{ min: number; max: number | null }>;
  location?: Evidence<{ name: string; city: string; address?: string; lat?: number; lon?: number }>;
};
const ages = new Set([0, 6, 12, 16, 18]);
export const explicitAge = jsonLdAge;
function amount(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return;
  const text = String(value).replace(/[\s\u00a0\u202f]/g, "");
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return;
  const number = Math.round(Number(text.replace(",", ".")));
  if (number <= 1_000_000) return number;
}
const list = (value: unknown): Row[] => (Array.isArray(value) ? value : [value]).filter((v): v is Row => !!v && typeof v === "object");
function structuredPrice(event: Row): EventDetails["price"] {
  const value = jsonLdPrice(event, true);
  if (value) return { value, method: "schema.org", quote: JSON.stringify(event.offers ?? { isAccessibleForFree: event.isAccessibleForFree }).slice(0, 500) };
}
function unique<T>(values: Evidence<T>[]): Evidence<T> | undefined {
  const distinct = new Map(values.map(v => [JSON.stringify(v.value), v]));
  return distinct.size === 1 ? [...distinct.values()][0] : undefined;
}

/** Только карточка с тем же названием; чужие события и рекомендации не служат доказательством. */
export function eventDetails(html: string, target: { title: string; startsAt: Date }): EventDetails {
  const title = normalizeTitle(target.title);
  const structured = jsonLdDetails(html).filter(e => normalizeTitle(String(e.name ?? "")) === title &&
    (!e.startDate || parseDate(e.startDate)?.getTime() === target.startsAt.getTime()));
  const result: EventDetails = { matched: structured.length > 0 };
  const structuredAges = structured.map(e => explicitAge(e.contentRating ?? e.typicalAgeRange)).filter((v): v is number => v != null)
    .map(value => ({ value, method: "schema.org" as const, quote: `contentRating/typicalAgeRange: ${value}+` }));
  result.age = unique(structuredAges);
  result.price = unique(structured.map(structuredPrice).filter((v): v is NonNullable<typeof v> => !!v));
  const places: NonNullable<EventDetails["location"]>[] = [];
  for (const event of structured) for (const loc of list(event.location)) {
    const address = list(loc.address)[0], geo = list(loc.geo)[0];
    const name = typeof loc.name === "string" ? loc.name.trim() : "", city = typeof address?.addressLocality === "string" ? address.addressLocality.trim() : "";
    const street = typeof address?.streetAddress === "string" ? address.streetAddress.trim() : typeof loc.address === "string" ? loc.address.trim() : undefined;
    const lat = Number(geo?.latitude), lon = Number(geo?.longitude);
    if (name && city) places.push({ value: { name, city, ...(street ? { address: street.slice(0, 300) } : {}),
      ...(Number.isFinite(lat) && Number.isFinite(lon) && lat >= 51 && lat <= 57 && lon >= 53 && lon <= 60.5 ? { lat, lon } : {}) },
      method: "schema.org", quote: JSON.stringify(loc).slice(0, 500) });
  }
  result.location = unique(places);
  // Чистый текст — возле единственного совпадающего H1, до рекомендаций других событий.
  const clean = html.replace(/<(script|style|noscript|svg|nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const headings = [...clean.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (headings.length !== 1 || normalizeTitle(htmlToText(headings[0][1])) !== title) return result;
  result.matched = true;
  const heading = headings[0], after = clean.slice(heading.index! + heading[0].length);
  const related = [...after.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].find(m => /вам (?:также )?понрав|похож|рекоменд|другие (?:события|спектакли|мероприятия)|также (?:в афише|в репертуаре)|ещ[ёе] (?:события|мероприятия)|смотрите также/i.test(htmlToText(m[1])));
  const boundary = related?.index ?? 60_000;
  const section = clean.slice(Math.max(0, heading.index! - 500), heading.index! + heading[0].length) + after.slice(0, Math.min(boundary, 60_000));
  const text = decodeEntities(htmlToText(section, 10_000));
  const ageHits = [...text.matchAll(/(?:^|[^\d])(0|6|12|16|18)\s*\+(?!\d)/g)].map(m => ({ value: +m[1], quote: m[0].trim(), method: "text" as const })).filter(v => ages.has(v.value));
  const textAge = unique(ageHits);
  if (textAge && (!result.age || result.age.value === textAge.value)) result.age = textAge;
  else if (ageHits.length) result.age = undefined;
  const textPrices: NonNullable<EventDetails["price"]>[] = [];
  for (const line of text.split("\n").map(s => s.trim()).filter(Boolean)) {
    if (/^(?:вход\s*(?::\s*)?свободный|бесплатный вход|вход\s*:\s*бесплатно|стоимость (?:входа|билета)\s*:\s*бесплатно)[.!]?$/i.test(line)) {
      textPrices.push({ value: { min: 0, max: 0 }, method: "text", quote: line }); continue;
    }
    const money = line.match(/^(?:(?:цена|стоимость)(?:\s+(?:входного\s+)?билета|\s+посещения|\s+входа)?\s*:\s*)?(от\s+)?(\d[\d\s\u00a0\u202f]*(?:[.,]\d{1,2})?)(?:\s*(?:до|[-–—])\s*(\d[\d\s\u00a0\u202f]*(?:[.,]\d{1,2})?))?\s*(?:₽|руб\.?|рублей|рубля)\s*[.!]?$/i);
    if (!money) continue;
    const min = amount(money[2]), max = money[3] ? amount(money[3]) : money[1] ? undefined : min;
    if (min != null && (max == null || max >= min)) textPrices.push({ value: { min, max: max ?? null }, method: "text", quote: line.slice(0, 500) });
  }
  const textPrice = unique(textPrices);
  if (textPrice && (!result.price || JSON.stringify(result.price.value) === JSON.stringify(textPrice.value))) result.price = textPrice;
  else if (textPrices.length) result.price = undefined;
  return result;
}
