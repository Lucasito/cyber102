import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { getSettings } from "./settings";

// Поиск событий — общий для веб-страницы, REST API, виджета, бота и ИИ-агента.
// Время республики — UTC+5 (Asia/Yekaterinburg), без перехода на летнее.

export const TZ = "Asia/Yekaterinburg";
const TZ_OFFSET = "+05:00";

/** «2026-11-14» → начало (или конец) этого дня по местному времени; полная дата ISO — как есть. */
function localDate(edge: "start" | "end") {
  return z.preprocess((v) => {
    if (typeof v !== "string") return v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T${edge === "start" ? "00:00:00" : "23:59:59"}${TZ_OFFSET}`);
    return new Date(v);
  }, z.date());
}

const bool = z.preprocess((v) => (typeof v === "string" ? v === "true" || v === "1" : v), z.boolean());

/** Доступная среда: коды и подписи. */
export const ACCESSIBILITY = { wheelchair: "Доступно на коляске", hearing: "Для слабослышащих", vision: "Для слабовидящих" } as const;
export type AccessCode = keyof typeof ACCESSIBILITY;

/** «54.7351,55.9587» → точка; радиус в км. */
const point = z
  .string()
  .regex(/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/)
  .transform((v) => {
    const [lat, lon] = v.split(",").map(Number);
    return { lat, lon };
  });

export const eventFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  category: z.string().trim().max(50).optional(),
  dateFrom: localDate("start").optional(),
  dateTo: localDate("end").optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
  free: bool.optional(),
  age: z.coerce.number().int().min(0).max(18).optional(), // возраст зрителя: показываем события с ageLimit <= age
  pushkin: bool.optional(), // можно по Пушкинской карте
  access: z.enum(["wheelchair", "hearing", "vision"]).optional(), // доступная среда
  near: point.optional(), // «рядом со мной»: lat,lon
  radius: z.coerce.number().min(1).max(300).optional(), // км, вместе с near; по умолчанию — из настроек
  status: z.enum(["SCHEDULED", "RESCHEDULED", "CANCELLED", "SOLD_OUT", "PAST"]).optional(),
  sort: z.enum(["date", "price_asc", "price_desc", "new", "distance"]).default("date"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type EventFilter = z.infer<typeof eventFilterSchema>;
type FilterInput = Omit<EventFilter, "sort"> & { sort?: EventFilter["sort"] };

export function parseEventFilter(params: URLSearchParams | Record<string, string | undefined>) {
  const entries = params instanceof URLSearchParams ? [...params] : Object.entries(params);
  return eventFilterSchema.safeParse(Object.fromEntries(entries.filter(([, v]) => v != null && v !== "")));
}

/** Сортировка. События без цены — в конце; при равенстве — по дате. distance — считается после выборки. */
const ORDER: Record<EventFilter["sort"], Prisma.EventOrderByWithRelationInput[]> = {
  date: [{ startsAt: "asc" }],
  price_asc: [{ priceMin: { sort: "asc", nulls: "last" } }, { startsAt: "asc" }],
  price_desc: [{ priceMax: { sort: "desc", nulls: "last" } }, { priceMin: { sort: "desc", nulls: "last" } }, { startsAt: "asc" }],
  new: [{ createdAt: "desc" }, { startsAt: "asc" }],
  distance: [{ startsAt: "asc" }],
};

export const SORT_LABELS: Record<Exclude<EventFilter["sort"], "distance">, string> = {
  date: "По дате",
  price_asc: "Сначала дешёвые",
  price_desc: "Сначала дорогие",
  new: "Новые в афише",
};

/** Расстояние по прямой, км (формула гаверсинусов). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Связи события для выдачи — общие для поиска и инструментов агента. */
export const eventInclude = { venue: true, category: true, sources: { select: { source: true, url: true } } } as const;
const include = eventInclude;

/**
 * Доля кино в общей выдаче (без жанра, текста и статуса). Киносеансов в афише больше, чем всех остальных событий,
 * и они почти всегда ближайшие по времени — без этого правила «куда сходить в субботу» отвечало бы одним кино.
 * Поэтому в общей выдаче фильм — одна карточка (ближайший сеанс), а фильмов не больше четверти первой страницы;
 * если других событий мало, кино добирает страницу. Все сеансы — с category=cinema.
 */
export const CINEMA_SHARE = 0.25;

export async function searchEvents(f: FilterInput) {
  if (f.category || f.q || f.status) return searchCore(f);
  const kino = await searchCore({ ...f, category: "cinema", offset: 0, limit: 100 });
  if (!kino.total) return searchCore(f);
  const seen = new Set<string>();
  const films = kino.items.filter((e) => {
    const key = e.normalizedTitle || e.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const restTotal = (await searchCore({ ...f, offset: 0, limit: 1 }, "cinema")).total;
  const cap = Math.max(1, Math.round(f.limit * CINEMA_SHARE));
  const shown = Math.min(films.length, Math.max(cap, f.limit - restTotal));
  const total = restTotal + shown;
  if (f.offset > 0) {
    const rest = await searchCore({ ...f, offset: Math.max(0, f.offset - shown) }, "cinema");
    return { ...rest, total, offset: f.offset };
  }
  const rest = await searchCore({ ...f, offset: 0, limit: Math.max(1, f.limit - shown) }, "cinema");
  const key = (e: (typeof rest.items)[number]) =>
    f.sort === "distance" ? e.distanceKm ?? Infinity
    : f.sort === "price_asc" ? e.priceMin ?? Infinity
    : f.sort === "price_desc" ? -(e.priceMax ?? e.priceMin ?? -Infinity)
    : f.sort === "new" ? -e.createdAt.getTime()
    : 0;
  const items = [...rest.items.slice(0, f.limit - shown), ...films.slice(0, shown)]
    // С возрастом события без возрастной пометки — в конце, как в searchCore
    .sort((a, b) => (f.age != null ? Number(a.ageLimit == null) - Number(b.ageLimit == null) : 0) || key(a) - key(b) || a.startsAt.getTime() - b.startsAt.getTime());
  return { items, total, limit: f.limit, offset: 0 };
}

/** Поиск по условиям; notCategory — исключить жанр (кино в общей выдаче добавляет searchEvents). */
async function searchCore(f: FilterInput, notCategory?: string) {
  const radius = f.radius ?? (await getSettings("tuning")).radiusKm;
  // «Рядом»: сначала грубо отсекаем квадратом в БД, потом точно по расстоянию
  const box = f.near
    ? {
        lat: { gte: f.near.lat - radius / 111, lte: f.near.lat + radius / 111 },
        lon: { gte: f.near.lon - radius / (111 * Math.cos((f.near.lat * Math.PI) / 180)), lte: f.near.lon + radius / (111 * Math.cos((f.near.lat * Math.PI) / 180)) },
      }
    : null;
  const where: Prisma.EventWhereInput = {
    // По умолчанию — только актуальные: отменённые и прошедшие в выдачу не попадают (ТЗ 6.1, метрика 11).
    // Отменённое доступно по прямой ссылке с пометкой и по явному status=CANCELLED.
    status: f.status ?? { notIn: ["PAST", "CANCELLED"] },
    publication: "PUBLISHED", // черновики и спорные карточки до проверки модератором не видны
    // Пересечение с периодом: событие началось до его конца и не закончилось до его начала.
    // Так в выборку попадают и идущие выставки. Без dateFrom период начинается «сейчас» (кроме поиска по статусу).
    startsAt: { lte: f.dateTo },
    AND: [
      ...(f.dateFrom || !f.status
        ? [{ OR: [{ startsAt: { gte: f.dateFrom ?? new Date() } }, { endsAt: { gte: f.dateFrom ?? new Date() } }] }]
        : []),
      f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }, { venue: { name: { contains: f.q, mode: "insensitive" } } }, { venue: { aliases: { some: { name: { contains: f.q, mode: "insensitive" } } } } }, { venue: { building: { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { aliases: { some: { name: { contains: f.q, mode: "insensitive" } } } }] } } }] } : {},
      f.age != null ? { OR: [{ ageLimit: null }, { ageLimit: { lte: f.age } }] } : {},
      f.city ? { venue: { city: { equals: f.city, mode: "insensitive" } } } : {},
      box ? { venue: { ...box, approx: false } } : {}, // центр города вместо адреса — не «рядом»
    ],
    ...(f.category ? { category: { slug: f.category } } : {}),
    ...(notCategory ? { NOT: { category: { is: { slug: notCategory } } } } : {}),
    ...(f.free ? { priceMin: 0 } : f.priceMax != null ? { priceMin: { lte: f.priceMax } } : {}),
    ...(f.pushkin ? { pushkinCard: true } : {}),
    ...(f.access ? { accessibility: { has: f.access } } : {}),
  };

  if (f.near) {
    // Точный радиус и сортировка по расстоянию — в памяти (событий в квадрате немного)
    const near = f.near;
    const all = (await db.event.findMany({ where, orderBy: ORDER[f.sort ?? "date"], take: 1000, include }))
      .map((e) => ({ ...e, distanceKm: e.venue?.lat != null && e.venue.lon != null ? distanceKm(near, { lat: e.venue.lat, lon: e.venue.lon }) : null }))
      .filter((e) => e.distanceKm != null && e.distanceKm <= radius);
    if (f.sort === "distance") all.sort((a, b) => a.distanceKm! - b.distanceKm!);
    // С фильтром по возрасту события без возрастной пометки — в конце (порядок внутри групп сохраняется)
    const sorted = f.age != null ? [...all.filter((e) => e.ageLimit != null), ...all.filter((e) => e.ageLimit == null)] : all;
    return { items: sorted.slice(f.offset, f.offset + f.limit), total: all.length, limit: f.limit, offset: f.offset };
  }

  if (f.age != null) {
    // Возраст указан: сначала события с подходящей пометкой, потом — без пометки (возраст неизвестен, уточнить у
    // организатора). Две выборки со сквозной постраничностью: offset/limit считаются по объединённому списку
    const and = where.AND as Prisma.EventWhereInput[];
    const known: Prisma.EventWhereInput = { ...where, AND: [...and, { ageLimit: { not: null } }] };
    const unknown: Prisma.EventWhereInput = { ...where, AND: [...and, { ageLimit: null }] };
    const [c1, c2] = await Promise.all([db.event.count({ where: known }), db.event.count({ where: unknown })]);
    const first = c1 > f.offset ? await db.event.findMany({ where: known, orderBy: ORDER[f.sort ?? "date"], skip: f.offset, take: f.limit, include }) : [];
    const rest = f.limit - first.length;
    const second = rest > 0 && c2 ? await db.event.findMany({ where: unknown, orderBy: ORDER[f.sort ?? "date"], skip: Math.max(0, f.offset - c1), take: rest, include }) : [];
    return { items: [...first, ...second].map((e) => ({ ...e, distanceKm: null as number | null })), total: c1 + c2, limit: f.limit, offset: f.offset };
  }

  const [items, total] = await Promise.all([
    db.event.findMany({ where, orderBy: ORDER[f.sort ?? "date"], take: f.limit, skip: f.offset, include }),
    db.event.count({ where }),
  ]);
  return { items: items.map((e) => ({ ...e, distanceKm: null as number | null })), total, limit: f.limit, offset: f.offset };
}

export type EventItem = Awaited<ReturnType<typeof searchEvents>>["items"][number];

/** Города и категории, где есть актуальные события, — для фильтров. */
export async function filterOptions() {
  const actual: Prisma.EventWhereInput = { status: { notIn: ["PAST", "CANCELLED"] }, publication: "PUBLISHED", startsAt: { gte: new Date(Date.now() - 86_400_000) } };
  const [cities, categories] = await Promise.all([
    db.venue.findMany({ where: { events: { some: actual } }, distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } }),
    db.category.findMany({ where: { events: { some: actual } }, orderBy: { name: "asc" } }),
  ]);
  return { cities: cities.map((c) => c.city), categories };
}

/** Местная дата YYYY-MM-DD со сдвигом в днях. */
export function localDay(offsetDays = 0, from = new Date()) {
  return new Date(from.getTime() + offsetDays * 86_400_000).toLocaleDateString("sv-SE", { timeZone: TZ });
}

/** Быстрые пресеты дат: сегодня, завтра, выходные (ближайшие сб–вс). */
export function datePresets(now = new Date()) {
  const weekday = Number(new Date(now.toLocaleString("en-US", { timeZone: TZ })).getDay()); // 0 = вс
  const toSat = weekday === 0 ? -1 : 6 - weekday;
  return {
    today: { dateFrom: localDay(0, now), dateTo: localDay(0, now) },
    tomorrow: { dateFrom: localDay(1, now), dateTo: localDay(1, now) },
    weekend: { dateFrom: localDay(Math.max(toSat, 0), now), dateTo: localDay(toSat + 1, now) },
  };
}
