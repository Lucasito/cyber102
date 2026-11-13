import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { MODE_LABELS, SOURCE_LABELS } from "@/lib/trace-labels";

const PAGE = 50;

/** Трассы ответов агента (ТЗ 7.4): запрос, режим, задержка, токены, стоимость. */
export default async function AdminTraces({ searchParams }: { searchParams: Promise<{ page?: string; mode?: string; source?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where = { ...(sp.mode ? { mode: sp.mode } : {}), ...(sp.source ? { source: sp.source } : {}) };
  const [items, total] = await Promise.all([
    db.queryLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE,
      skip: (page - 1) * PAGE,
      select: { id: true, createdAt: true, source: true, text: true, results: true, clarify: true, relaxed: true, mode: true, latencyMs: true, tokens: true, costRub: true },
    }),
    db.queryLog.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (q: { page?: number; mode?: string; source?: string }) => {
    const p = { mode: sp.mode, source: sp.source, ...q };
    const params = new URLSearchParams();
    if (p.mode) params.set("mode", p.mode);
    if (p.source) params.set("source", p.source);
    if (p.page && p.page > 1) params.set("page", String(p.page));
    return `/admin/traces${params.size ? `?${params}` : ""}`;
  };
  const chip = (active: boolean) => `rounded-full px-3 py-1.5 ${active ? "bg-stone-900 text-white" : "bg-white ring-1 ring-black/10"}`;
  return (
    <>
      <PageTitle title="Трассы ответов" desc="Каждый ответ помощника: как разобран запрос, какие поиски выполнены, на каких событиях основан ответ, сколько стоил и сколько занял." />
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={href({ mode: "" })} className={chip(!sp.mode)}>
          Все режимы
        </Link>
        {Object.entries(MODE_LABELS).map(([k, v]) => (
          <Link key={k} href={href({ mode: k })} className={chip(sp.mode === k)}>
            {v}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={href({ source: "" })} className={chip(!sp.source)}>
          Все источники
        </Link>
        {Object.entries(SOURCE_LABELS).map(([k, v]) => (
          <Link key={k} href={href({ source: k })} className={chip(sp.source === k)}>
            {v}
          </Link>
        ))}
      </div>
      <Section>
        {items.length ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="px-2 py-1 font-normal">Когда</th>
                  <th className="px-2 py-1 font-normal">Запрос</th>
                  <th className="px-2 py-1 font-normal">Итог</th>
                  <th className="px-2 py-1 font-normal">Режим</th>
                  <th className="px-2 py-1 text-right font-normal">Время</th>
                  <th className="px-2 py-1 text-right font-normal">Токены</th>
                  <th className="px-2 py-1 text-right font-normal">₽</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t border-black/5 align-top">
                    <td className="px-2 py-1.5 whitespace-nowrap text-stone-500">
                      {r.createdAt.toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      <div className="text-xs">{SOURCE_LABELS[r.source] ?? r.source}</div>
                    </td>
                    <td className="px-2 py-1.5">
                      <Link href={`/admin/traces/${r.id}`} className="hover:underline">
                        {r.text.slice(0, 120) || "—"}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.clarify ? "уточнение" : `${r.results} соб.${r.relaxed ? ", ослаблено" : ""}`}</td>
                    <td className={`px-2 py-1.5 whitespace-nowrap ${r.mode === "ai" ? "" : "text-amber-700"}`}>{MODE_LABELS[r.mode] ?? r.mode}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.latencyMs ? `${(r.latencyMs / 1000).toFixed(1)} с` : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.tokens || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.costRub ? r.costRub.toFixed(2) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-stone-500">Пока нет ответов</p>
        )}
        {pages > 1 && (
          <nav className="mt-4 flex justify-between text-sm" aria-label="Страницы">
            {page > 1 ? <Link href={href({ page: page - 1 })}>← Новее</Link> : <span />}
            <span className="text-stone-500">
              {page} из {pages}
            </span>
            {page < pages ? <Link href={href({ page: page + 1 })}>Старше →</Link> : <span />}
          </nav>
        )}
      </Section>
    </>
  );
}
