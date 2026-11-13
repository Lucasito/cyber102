import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { AgentReply } from "./agent";
import { db } from "./db";

// Журнал запросов к помощнику (таблица QueryLog) и сводка для админки.

export type QuerySource = "site" | "api" | "max" | "telegram";

/** Записать запрос; ошибки записи не мешают ответу пользователю. */
export function logQuery(source: QuerySource, text: string, reply: AgentReply) {
  const filter = reply.filter ? (JSON.parse(JSON.stringify({ ...reply.filter, limit: undefined, offset: undefined })) as Prisma.InputJsonValue) : undefined;
  void db.queryLog
    .create({
      data: {
        source,
        text: text.slice(0, 500),
        filter,
        results: reply.events.length,
        clarify: !!reply.clarify,
        relaxed: !!reply.relaxed,
        degraded: !!reply.degraded,
      },
    })
    .catch((e) => console.error("[analytics]", e instanceof Error ? e.message : e));
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}\s₽]/gu, " ").replace(/\s+/g, " ").trim();

/** Сводка за N дней: по дням, по источникам, популярные запросы и запросы без точного результата. */
export async function analyticsSummary(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.queryLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 5000 });

  const byDay = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) byDay.set(new Date(Date.now() - i * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Asia/Yekaterinburg" }), 0);
  const bySource: Record<string, number> = {};
  const top = new Map<string, { text: string; count: number }>();
  const missed = new Map<string, { text: string; count: number; results: number }>();

  for (const r of rows) {
    const day = r.createdAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Yekaterinburg" });
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
  return {
    days,
    total: rows.length,
    clarified: rows.filter((r) => r.clarify).length,
    degraded: rows.filter((r) => r.degraded).length,
    byDay: [...byDay.entries()].map(([day, count]) => ({ day, count })),
    bySource,
    top: sorted(top),
    missed: sorted(missed),
  };
}
