import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { AgentReply, TraceStep } from "./agent";
import type { AiCall } from "./ai";
import { db } from "./db";

// Журнал запросов к помощнику (таблица QueryLog) с трассой каждого ответа и сводка для админки.

export type QuerySource = "site" | "api" | "max" | "telegram" | "eval";

export type TraceMeta = {
  userKey?: string;
  dialogKey?: string;
  mode: string;
  latencyMs: number;
  tokens: number;
  costRub: number;
  steps: TraceStep[];
  calls: AiCall[];
};

const toJson = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/** Записать запрос и трассу ответа; ошибки записи не мешают ответу пользователю. Ждём записи: следующая реплика читает трассу. */
export async function saveTrace(id: string, source: QuerySource, text: string, reply: AgentReply, meta: TraceMeta) {
  // near не храним: это может быть местоположение человека («рядом со мной»); уточнения его не используют
  const filter = reply.filter ? toJson({ ...reply.filter, limit: undefined, offset: undefined, near: undefined }) : undefined;
  await db.queryLog
    .create({
      data: {
        id,
        source,
        text: text.slice(0, 500),
        filter,
        results: reply.events.length,
        clarify: !!reply.clarify,
        relaxed: !!reply.relaxed,
        degraded: !!reply.degraded,
        userKey: meta.userKey,
        dialogKey: meta.dialogKey,
        mode: meta.mode,
        latencyMs: meta.latencyMs,
        tokens: meta.tokens,
        costRub: meta.costRub,
        eventIds: reply.events.map((e) => e.id),
        trace: toJson({ steps: meta.steps, calls: meta.calls, reply: reply.text }),
      },
    })
    .catch((e) => console.error("[analytics]", e instanceof Error ? e.message : e));
}

/** Сколько потрачено на ИИ (₽) пользователем или в диалоге — для лимитов стоимости. */
export async function spentRub(where: { userKey?: string; dialogKey?: string; since?: Date }) {
  const r = await db.queryLog.aggregate({
    _sum: { costRub: true },
    where: { userKey: where.userKey, dialogKey: where.dialogKey, ...(where.since ? { createdAt: { gte: where.since } } : {}) },
  });
  return r._sum.costRub ?? 0;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}\s₽]/gu, " ").replace(/\s+/g, " ").trim();

/** Сводка за N дней: по дням, по источникам, популярные запросы и запросы без точного результата. */
export async function analyticsSummary(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  // Прогоны контрольного набора (eval) — не пользователи, в сводку не входят
  const rows = await db.queryLog.findMany({
    where: { createdAt: { gte: since }, source: { not: "eval" } },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: { source: true, text: true, results: true, clarify: true, relaxed: true, degraded: true, createdAt: true, latencyMs: true, costRub: true, dialogKey: true },
  });

  // График — с первого дня, когда есть записи (не раньше начала периода): без пустых дней до запуска сервиса
  const first = await db.queryLog.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const localDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Yekaterinburg" });
  const startDay = first && first.createdAt > since ? localDay(first.createdAt) : localDay(since);
  const byDay = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const day = localDay(new Date(Date.now() - i * 86_400_000));
    if (day >= startDay || i === 0) byDay.set(day, 0);
  }
  const bySource: Record<string, number> = {};
  const top = new Map<string, { text: string; count: number }>();
  const missed = new Map<string, { text: string; count: number; results: number }>();

  for (const r of rows) {
    const day = localDay(r.createdAt);
    if (byDay.has(day)) byDay.set(day, byDay.get(day)! + 1);
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    const key = norm(r.text);
    if (!key || key.length < 3) continue;
    const t = top.get(key) ?? { text: r.text, count: 0 };
    t.count++;
    top.set(key, t);
    // «Чего не хватает в афише»: ничего не нашлось или пришлось ослабить условия
    if (!r.clarify && (r.results === 0 || r.relaxed)) {
      const m = missed.get(key) ?? { text: r.text, count: 0, results: r.results };
      m.count++;
      missed.set(key, m);
    }
  }
  const sorted = <T extends { count: number }>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  // Стоимость и задержка: средний диалог и 95-й процентиль задержки (пороги ТЗ: диалог ≤ 3 ₽, p95 ≤ 6 с)
  const cost = rows.reduce((n, r) => n + r.costRub, 0);
  const dialogs = new Set(rows.map((r) => r.dialogKey).filter(Boolean)).size;
  const latencies = rows.map((r) => r.latencyMs).filter((ms) => ms > 0).sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] : 0;
  return {
    days,
    total: rows.length,
    costRub: cost,
    costPerDialog: dialogs ? cost / dialogs : 0,
    p95Ms: p95,
    clarified: rows.filter((r) => r.clarify).length,
    degraded: rows.filter((r) => r.degraded).length,
    byDay: [...byDay.entries()].map(([day, count]) => ({ day, count })),
    bySource,
    top: sorted(top),
    missed: sorted(missed),
  };
}

// ───────── Покрытие афиши: спрос и предложение по городам и категориям ─────────

export type CoverageRow = { key: string; label: string; requests: number; missed: number; events: number };

/**
 * Где афиша не закрывает спрос (ТЗ, раздел 14). Спрос — запросы к помощнику (сайт, API, боты) за период:
 * запрошенные город и категория берутся из трассы (шаг «rules» — до ослабления условий), «не нашлось» — пусто
 * или пришлось снять условие. Предложение — актуальные опубликованные события. Сетка «город × категория» —
 * где событий нет совсем.
 */
export async function coverageSummary(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const now = new Date();
  const [logs, events, categories] = await Promise.all([
    db.queryLog.findMany({
      where: { createdAt: { gte: since }, source: { not: "eval" }, clarify: false },
      select: { results: true, relaxed: true, filter: true, trace: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    db.event.findMany({
      where: { publication: "PUBLISHED", status: { notIn: ["PAST", "CANCELLED"] }, OR: [{ startsAt: { gte: now } }, { endsAt: { gte: now } }] },
      select: { venue: { select: { city: true } }, category: { select: { slug: true } } },
    }),
    db.category.findMany({ select: { slug: true, name: true } }),
  ]);
  const catName = new Map(categories.map((c) => [c.slug, c.name]));
  const cityKey = (c: string) => c.trim().toLowerCase().replace(/ё/g, "е");
  const cityLabel = new Map<string, string>();
  const byCity = new Map<string, CoverageRow>();
  const byCat = new Map<string, CoverageRow>();
  const grid = new Map<string, number>(); // «город|категория» → событий
  const row = (m: Map<string, CoverageRow>, key: string, label: string) => {
    let r = m.get(key);
    if (!r) m.set(key, (r = { key, label, requests: 0, missed: 0, events: 0 }));
    return r;
  };

  for (const e of events) {
    const city = e.venue?.city;
    if (city) {
      cityLabel.set(cityKey(city), city);
      row(byCity, cityKey(city), city).events++;
    }
    const cat = e.category?.slug;
    if (cat) row(byCat, cat, catName.get(cat) ?? cat).events++;
    if (city && cat) grid.set(`${cityKey(city)}|${cat}`, (grid.get(`${cityKey(city)}|${cat}`) ?? 0) + 1);
  }

  for (const l of logs) {
    const steps = ((l.trace as { steps?: TraceStep[] } | null)?.steps ?? []) as TraceStep[];
    const asked = (steps.find((s) => s.step === "rules")?.merged ?? l.filter ?? {}) as Record<string, unknown>;
    const missed = l.results === 0 || l.relaxed;
    if (typeof asked.city === "string" && asked.city.trim()) {
      const k = cityKey(asked.city);
      const r = row(byCity, k, cityLabel.get(k) ?? asked.city.trim());
      r.requests++;
      if (missed) r.missed++;
    }
    if (typeof asked.category === "string" && asked.category) {
      const r = row(byCat, asked.category, catName.get(asked.category) ?? asked.category);
      r.requests++;
      if (missed) r.missed++;
    }
  }

  // Сначала — где спрос не закрыт: больше «не нашлось», потом меньше событий на запрос
  const order = (a: CoverageRow, b: CoverageRow) => b.missed - a.missed || a.events / Math.max(a.requests, 1) - b.events / Math.max(b.requests, 1) || b.requests - a.requests;
  const cities = [...byCity.values()].sort(order);
  const cats = [...byCat.values()].sort(order);
  // Сетка: города с событиями или спросом (до 10) × категории справочника
  const gridCities = [...byCity.values()].sort((a, b) => b.events + b.requests - (a.events + a.requests)).slice(0, 10);
  return {
    days,
    requests: logs.length,
    cities,
    categories: cats,
    grid: {
      cities: gridCities.map((c) => ({ key: c.key, label: c.label })),
      categories: categories.map((c) => ({ key: c.slug, label: c.name })),
      count: (city: string, cat: string) => grid.get(`${city}|${cat}`) ?? 0,
    },
  };
}
