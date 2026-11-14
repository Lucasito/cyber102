import Link from "next/link";
import { PageTitle, QueryList, Section, Stat } from "@/components/admin/blocks";
import { requireAdmin } from "@/lib/server/admin";
import { analyticsSummary, coverageSummary, type CoverageRow } from "@/lib/server/analytics";
import { db } from "@/lib/server/db";
import { getSettings } from "@/lib/server/settings";
import { SOURCE_LABELS } from "@/lib/trace-labels";


/** Вывод по строке покрытия: событий нет при спросе, спрос не закрыт, мало событий. */
function verdict(r: CoverageRow): [string, string] {
  if (r.requests && !r.events) return ["событий нет", "bg-red-100 text-red-800"];
  if (r.requests >= 2 && r.missed / r.requests >= 0.5) return ["спрос не закрыт", "bg-amber-100 text-amber-900"];
  if (r.events < 5) return ["мало событий", "bg-amber-50 text-amber-800"];
  return ["", ""];
}

function CoverageTable({ title, rows }: { title: string; rows: CoverageRow[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-sm font-medium text-stone-700">{title}</p>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-stone-500">
              <tr>
                <th className="py-1 pr-2 font-medium" />
                <th className="px-2 py-1 text-right font-medium">запросов</th>
                <th className="px-2 py-1 text-right font-medium">не нашлось</th>
                <th className="px-2 py-1 text-right font-medium">событий</th>
                <th className="py-1 pl-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {rows.slice(0, 15).map((r) => {
                const [label, cls] = verdict(r);
                return (
                  <tr key={r.key}>
                    <td className="py-1.5 pr-2">{r.label}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.requests || "—"}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${r.missed ? "font-medium text-red-700" : ""}`}>{r.missed || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.events}</td>
                    <td className="py-1.5 pl-2">{label && <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${cls}`}>{label}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-stone-500">Пока нет данных</p>
      )}
    </div>
  );
}

export default async function AdminAnalytics() {
  await requireAdmin();
  const tuning = await getSettings("tuning");
  const [stats, reminders, cov] = await Promise.all([analyticsSummary(tuning.analyticsDays), db.reminder.count({ where: { sentAt: null } }), coverageSummary(Math.max(tuning.analyticsDays, 30))]);
  const maxDay = Math.max(1, ...stats.byDay.map((d) => d.count));
  return (
    <>
      <PageTitle title="Аналитика" desc={`Запросы к умному помощнику на сайте, через API и в ботах за ${stats.days} дн. Период меняется в «Тонкой настройке».`} />
      <Section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="запросов" value={stats.total} />
          <Stat label="с уточнением" value={stats.clarified} />
          <Stat label="ответов без ИИ" value={stats.degraded} />
          <Stat label="ждут напоминаний" value={reminders} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="расходы на ИИ, ₽" value={stats.costRub.toFixed(2)} />
          <Stat label="₽ на диалог (порог 3)" value={stats.costPerDialog.toFixed(2)} tone={stats.costPerDialog > 3 ? "warn" : undefined} />
          <Stat label="задержка p95, с (порог 6)" value={(stats.p95Ms / 1000).toFixed(1)} tone={stats.p95Ms > 6000 ? "warn" : undefined} />
          <Stat label="трассы ответов" value={<Link href="/admin/traces" className="underline">открыть</Link>} />
        </div>
        <div className="mt-6 grid gap-6 sm:grid-cols-[2fr_1fr]">
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700">По дням</p>
            <div className="flex h-32 items-end gap-2">
              {stats.byDay.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs tabular-nums text-stone-500">{d.count || ""}</span>
                  <div className="w-full rounded-t-md bg-[var(--brand)]/80" style={{ height: `${(d.count / maxDay) * 88}px`, minHeight: d.count ? 4 : 1 }} />
                  <span className="text-[11px] text-stone-500">
                    {d.day.slice(8)}.{d.day.slice(5, 7)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700">Откуда</p>
            {Object.keys(stats.bySource).length ? (
              <ul className="space-y-1 text-sm">
                {Object.entries(stats.bySource)
                  .sort((a, b) => b[1] - a[1])
                  .map(([s, n]) => (
                    <li key={s} className="flex justify-between gap-4">
                      <span>{SOURCE_LABELS[s] ?? s}</span>
                      <b className="tabular-nums">{n}</b>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">Пока нет запросов</p>
            )}
          </div>
        </div>
      </Section>
      <Section>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700">Популярные запросы</p>
            <QueryList items={stats.top} empty="Пока нет запросов" />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700">Чего не хватает в афише</p>
            <p className="mb-2 text-xs text-stone-500">Ничего не нашлось или пришлось показать похожее — подсказка, какие события стоит добавить.</p>
            <QueryList items={stats.missed} empty="Всё находится" />
          </div>
        </div>
      </Section>
      <Section
        title="Покрытие афиши: спрос и предложение"
        desc={`Какие города и категории плохо покрыты. Спрос — ${cov.requests} запросов к помощнику на сайте, через API и в ботах за ${cov.days} дн. (город и категория — как спросили, до ослабления условий); «не нашлось» — пусто или пришлось показать похожее. Событий — актуальные опубликованные сейчас.`}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <CoverageTable title="Города" rows={cov.cities} />
          <CoverageTable title="Категории" rows={cov.categories} />
        </div>
        {cov.grid.cities.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-sm font-medium text-stone-700">Событий по городам и категориям</p>
            <p className="mb-2 text-xs text-stone-500">Пустые клетки — в этом городе нет событий этой категории: кандидаты для новых источников.</p>
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr>
                    <th />
                    {cov.grid.categories.map((c) => (
                      <th key={c.key} className="px-1.5 py-1 text-center font-medium whitespace-nowrap text-stone-500">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cov.grid.cities.map((city) => (
                    <tr key={city.key}>
                      <td className="py-1 pr-2 whitespace-nowrap">{city.label}</td>
                      {cov.grid.categories.map((c) => {
                        const n = cov.grid.count(city.key, c.key);
                        return (
                          <td key={c.key} className="p-0.5">
                            <div className={`rounded px-1.5 py-1 text-center tabular-nums ${n ? "bg-[var(--brand)]/10 text-stone-800" : "bg-red-50 text-red-300"}`}>{n || "·"}</div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
