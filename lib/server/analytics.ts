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
  const filter = reply.filter ? toJson({ ...reply.filter, limit: undefined, offset: undefined }) : undefined;
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
