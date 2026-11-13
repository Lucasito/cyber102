import Link from "next/link";
import { PageTitle, QueryList, Section, Stat } from "@/components/admin/blocks";
import { requireAdmin } from "@/lib/server/admin";
import { analyticsSummary } from "@/lib/server/analytics";
import { db } from "@/lib/server/db";
import { getSettings } from "@/lib/server/settings";
import { SOURCE_LABELS } from "@/lib/trace-labels";


export default async function AdminAnalytics() {
  await requireAdmin();
  const [stats, reminders] = await Promise.all([getSettings("tuning").then((t) => analyticsSummary(t.analyticsDays)), db.reminder.count({ where: { sentAt: null } })]);
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
    </>
  );
}
