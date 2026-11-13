import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { botLinks } from "./bot-links";
import { db } from "./db";
import { eventFilterSchema, eventInclude, searchEvents, TZ, type EventFilter, type EventItem } from "./events";
import { saveFeedback } from "./feedback";

// Инструменты ИИ-агента (ТЗ 7.2). Каждый возвращает структурированный результат (JSON), а не текст ответа:
// ответ из результата собирает агент. Модель только выбирает инструмент и аргументы — исполняет код.
// Ошибка инструмента не подменяется догадкой: агент сообщает о проблеме (ok: false).
// Изменение данных (subscribe, save_feedback) — только после подтверждения пользователем (confirmed).

export const TOOL_NAMES = ["search_events", "get_event", "find_similar", "get_venue_schedule", "subscribe", "save_feedback"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolContext = {
  /** Пользователь бота: подписка оформляется ему. Без него (сайт, API) — подсказка, где подписаться. */
  botUserId?: string;
  /** Пользователь подтвердил изменение данных. */
  confirmed?: boolean;
  source: "site" | "api" | "bot" | "eval";
};

/** Результат: data — JSON для трассы и сборки ответа; items — события для карточек (не сериализуются в трассу). */
export type ToolResult = { ok: true; data: Record<string, unknown>; items?: EventItem[] } | { ok: false; error: string };

/** Описание инструментов для промпта модели. */
export const TOOL_PROMPT = `Инструменты (поле "tool", аргументы — в "args"):
- search_events — поиск событий по фильтру (по умолчанию; аргументы — поле "filter").
- get_event — вопрос о конкретном событии по названию: статус (отменено, перенесено), цена, где, когда. args: {"title": string}.
- find_similar — «похожее на <событие>». args: {"title": string}.
- get_venue_schedule — что идёт на конкретной площадке (театр, филармония, музей, ДК). args: {"venue": string}; период — в "filter".
- subscribe — подписаться на новые события. args: {"city": string?, "category": string?}.
- save_feedback — передать сообщение организатору или сообщить об ошибке в карточке. args: {"title": string?, "message": string}.`;

/** Компактное представление события для трассы. */
export function eventBrief(e: { id: string; title: string; startsAt: Date; status?: string; priceMin: number | null; ageLimit: number | null; venue: { name: string; city: string } | null }) {
  return {
    id: e.id,
    title: e.title,
    startsAt: e.startsAt.toISOString(),
    status: e.status,
    priceMin: e.priceMin,
    ageLimit: e.ageLimit,
    venue: e.venue?.name ?? null,
    city: e.venue?.city ?? null,
  };
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined);

/** Событие по названию: точное вхождение, иначе — все слова названия (по основе). */
async function findByTitle(title: string, where: Prisma.EventWhereInput = {}) {
  const base: Prisma.EventWhereInput = { publication: "PUBLISHED", status: { not: "PAST" }, ...where };
  const direct = await db.event.findMany({ where: { ...base, title: { contains: title, mode: "insensitive" } }, include: eventInclude, orderBy: { startsAt: "asc" }, take: 5 });
  if (direct.length) return direct;
  const words = title
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w.length >= 4)
    .map((w) => (w.length > 5 ? w.slice(0, -2) : w));
  if (!words.length) return [];
  return db.event.findMany({
    where: { ...base, AND: words.map((w) => ({ title: { contains: w, mode: "insensitive" as const } })) },
    include: eventInclude,
    orderBy: { startsAt: "asc" },
    take: 5,
  });
}

/** Период из аргументов (строки YYYY-MM-DD) — через ту же схему, что и поиск. */
function period(args: Record<string, unknown>) {
  const p = eventFilterSchema.pick({ dateFrom: true, dateTo: true }).safeParse({ dateFrom: str(args.dateFrom), dateTo: str(args.dateTo) });
  return p.success ? p.data : {};
}

// ───────── Инструменты ─────────

async function searchEventsTool(args: Record<string, unknown>, exclude: Set<string> = new Set()): Promise<ToolResult> {
  const f = eventFilterSchema.safeParse(args);
  if (!f.success) return { ok: false, error: `неверный фильтр: ${f.error.issues.map((i) => i.path.join(".")).join(", ")}` };
  const r = await searchEvents({ ...f.data, limit: f.data.limit + exclude.size });
  const items = r.items.filter((e) => !exclude.has(e.id)).slice(0, f.data.limit);
  return { ok: true, data: { total: r.total, events: items.map(eventBrief) }, items };
}

async function getEventTool(args: Record<string, unknown>): Promise<ToolResult> {
  const id = str(args.id);
  const title = str(args.title);
  if (!id && !title) return { ok: false, error: "нужен id или название события" };
  // Отменённые тоже: на вопрос «отменили ли…» нужен честный ответ
  const rows = id
    ? await db.event.findMany({ where: { id, publication: "PUBLISHED" }, include: eventInclude })
    : await findByTitle(title!);
  const events = rows.map((e) => ({
    ...eventBrief(e),
    endsAt: e.endsAt?.toISOString() ?? null,
    originalStartsAt: e.originalStartsAt?.toISOString() ?? null,
    priceMax: e.priceMax,
    source: e.sources[0]?.url ?? null,
    ticketUrl: e.ticketUrl,
  }));
  return { ok: true, data: { found: rows.length, events }, items: rows.filter((e) => e.status !== "CANCELLED").map((e) => ({ ...e, distanceKm: null })) };
}

async function findSimilarTool(args: Record<string, unknown>, limit: number, exclude: Set<string>): Promise<ToolResult> {
  const title = str(args.title);
  const id = str(args.id);
  const base = id ? await db.event.findUnique({ where: { id }, include: eventInclude }) : title ? (await findByTitle(title))[0] : null;
  if (!base) return { ok: true, data: { base: null, events: [] }, items: [] };
  const f: EventFilter = eventFilterSchema.parse({
    limit,
    category: base.category?.slug,
    city: str(args.city) ?? base.venue?.city,
    ...period(args),
  });
  const r = await searchEventsTool({ ...f }, new Set([...exclude, base.id]));
  if (!r.ok) return r;
  return { ok: true, data: { base: eventBrief(base), category: f.category ?? null, ...r.data }, items: r.items };
}

async function venueScheduleTool(args: Record<string, unknown>, limit: number): Promise<ToolResult> {
  const venue = str(args.venue);
  if (!venue) return { ok: false, error: "не указана площадка" };
  // Площадка по названию: вхождение целиком, иначе все значимые слова по основе из 5 букв
  // («кукольного» → «кукол», «гармонии» → «гармо»)
  const words = venue
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w.length >= 4 && !/^(театр|музе|центр|зал|концертн)/.test(w))
    .map((w) => w.slice(0, 5));
  let venues = await db.venue.findMany({ where: { name: { contains: venue, mode: "insensitive" } }, select: { id: true, name: true, city: true } });
  if (!venues.length && words.length) {
    venues = await db.venue.findMany({ where: { AND: words.map((w) => ({ name: { contains: w, mode: "insensitive" as const } })) }, select: { id: true, name: true, city: true } });
  }
  if (!venues.length) return { ok: true, data: { venues: [], events: [] }, items: [] };
  const p = period(args);
  const from = p.dateFrom ?? new Date();
  const items = await db.event.findMany({
    where: {
      venueId: { in: venues.map((v) => v.id) },
      status: { notIn: ["PAST", "CANCELLED"] },
      publication: "PUBLISHED",
      ...(p.dateTo ? { startsAt: { lte: p.dateTo } } : {}),
      OR: [{ startsAt: { gte: from } }, { endsAt: { gte: from } }],
    },
    include: eventInclude,
    orderBy: { startsAt: "asc" },
    take: limit,
  });
  return { ok: true, data: { venues, events: items.map(eventBrief) }, items: items.map((e) => ({ ...e, distanceKm: null })) };
}

async function subscribeTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const city = str(args.city) ?? null;
  const categorySlug = str(args.category) ?? null;
  const category = categorySlug ? await db.category.findUnique({ where: { slug: categorySlug }, select: { slug: true, name: true } }) : null;
  const what = { city, category: category?.slug ?? null, categoryName: category?.name ?? null };
  if (!ctx.botUserId) {
    // На сайте и в API нет аккаунта для уведомлений — подписка оформляется в боте
    return { ok: true, data: { ...what, needsBot: true, bots: (await botLinks()).map((b) => ({ label: b.label, url: b.url })) } };
  }
  if (!ctx.confirmed) return { ok: true, data: { ...what, needsConfirmation: true } };
  const exists = await db.subscription.findFirst({ where: { botUserId: ctx.botUserId, city, category: what.category } });
  if (exists) return { ok: true, data: { ...what, id: exists.id, created: false } };
  if ((await db.subscription.count({ where: { botUserId: ctx.botUserId } })) >= 10) return { ok: false, error: "подписок уже 10 — удалите лишние в /subs" };
  const sub = await db.subscription.create({ data: { botUserId: ctx.botUserId, city, category: what.category } });
  return { ok: true, data: { ...what, id: sub.id, created: true } };
}

async function saveFeedbackTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const message = str(args.message) ? String(args.message).trim().slice(0, 3000) : undefined;
  if (!message || message.length < 10) return { ok: false, error: "сообщение слишком короткое — опишите подробнее" };
  const title = str(args.title);
  const event = str(args.eventId)
    ? await db.event.findUnique({ where: { id: String(args.eventId) }, select: { id: true, title: true } })
    : title
      ? ((await findByTitle(title))[0] ?? null)
      : null;
  const kind = /ошиб|неверн|неправильн|не та|устарел/i.test(message) ? "correction" : event ? "organizer" : "question";
  const what = { kind, message, event: event ? { id: event.id, title: event.title } : null };
  if (!ctx.confirmed) return { ok: true, data: { ...what, needsConfirmation: true } };
  const fb = await saveFeedback({ kind, eventId: event?.id, message }, ctx.source === "eval" ? "api" : ctx.source);
  return { ok: true, data: { ...what, id: fb.id, saved: true } };
}

/** Вызвать инструмент. Исключение внутри — ok: false с текстом ошибки, без догадок. */
export async function runTool(name: ToolName, args: Record<string, unknown>, ctx: ToolContext, opts: { limit: number; exclude?: Set<string> }): Promise<ToolResult> {
  try {
    switch (name) {
      case "search_events":
        return await searchEventsTool({ ...args, limit: args.limit ?? opts.limit }, opts.exclude);
      case "get_event":
        return await getEventTool(args);
      case "find_similar":
        return await findSimilarTool(args, opts.limit, opts.exclude ?? new Set());
      case "get_venue_schedule":
        return await venueScheduleTool(args, opts.limit);
      case "subscribe":
        return await subscribeTool(args, ctx);
      case "save_feedback":
        return await saveFeedbackTool(args, ctx);
    }
  } catch (e) {
    console.error(`[agent-tools] ${name}:`, e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Дата и время события словами — для ответов, которые собирает код. */
export const fmtWhen = (iso: string) => new Date(iso).toLocaleString("ru-RU", { timeZone: TZ, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
