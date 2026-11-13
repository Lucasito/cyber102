import Link from "next/link";
import { PageTitle, Section, Stat } from "@/components/admin/blocks";
import { DEMO_SOURCE } from "@/lib/demo-data";
import { aiProviderName } from "@/lib/server/ai";
import { requireAdmin } from "@/lib/server/admin";
import { analyticsSummary } from "@/lib/server/analytics";
import { db } from "@/lib/server/db";
import { getSettings } from "@/lib/server/settings";

/** Обзор: главные цифры и что требует внимания. Подробности — в разделах меню. */
export default async function AdminOverview() {
  const me = await requireAdmin("MODERATOR");
  const now = new Date();
  const [total, upcoming, demo, cancelled, users] = await Promise.all([
    db.event.count(),
    db.event.count({ where: { status: { notIn: ["PAST", "CANCELLED"] }, OR: [{ startsAt: { gte: now } }, { endsAt: { gte: now } }] } }),
    db.event.count({ where: { sources: { some: { source: DEMO_SOURCE } } } }),
    db.event.count({ where: { status: "CANCELLED", startsAt: { gte: now } } }),
    db.botUser.groupBy({ by: ["platform"], _count: true }),
  ]);
  const botUsers = (p: string) => users.find((u) => u.platform === p)?._count ?? 0;

  const isAdmin = me.role === "ADMIN";
  const [provider, ai, max, tg, stats] = isAdmin
    ? await Promise.all([aiProviderName(), getSettings("ai"), getSettings("max"), getSettings("telegram"), getSettings("tuning").then((t) => analyticsSummary(t.analyticsDays))])
    : [null, null, null, null, null];

  // Что требует внимания администратора — со ссылкой на нужный раздел
  const todo: { text: string; href: string }[] = [];
  if (isAdmin) {
    if (!ai?.enabled || !provider) todo.push({ text: "ИИ-помощник выключен или не настроен — работает обычный поиск по правилам", href: "/admin/ai" });
    if (!max?.enabled && !tg?.enabled) todo.push({ text: "Ни один бот не включён", href: "/admin/bots" });
    if (demo > 0) todo.push({ text: `В базе ${demo} тестовых событий — на сайте видна плашка «Тестовые данные»`, href: "/admin/data" });
  }

  return (
    <>
      <PageTitle title={`Здравствуйте, ${me.login}`} desc={isAdmin ? "Состояние афиши и что стоит проверить." : "Ваша роль — модератор. Разделы импорта и модерации событий появятся в меню."} />
      <Section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="актуальных событий" value={upcoming} />
          <Stat label="всего в базе" value={total} />
          <Stat label="отменённых впереди" value={cancelled} tone={cancelled ? "warn" : undefined} />
          <Stat label="тестовых" value={demo} tone={demo ? "warn" : undefined} />
        </div>
      </Section>

      {isAdmin && stats && (
        <Section title="Помощник и боты">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={`запросов за ${stats.days} дн.`} value={stats.total} />
            <Stat label="ответов без ИИ" value={stats.degraded} />
            <Stat label="пользователей MAX" value={botUsers("max")} />
            <Stat label="пользователей Telegram" value={botUsers("telegram")} />
          </div>
          <p className="mt-4 text-sm text-stone-500">
            ИИ: <b className="text-stone-800">{provider ?? "выключен"}</b> ·{" "}
            <Link href="/admin/analytics" className="underline-offset-2 hover:underline">
              подробная аналитика →
            </Link>
          </p>
        </Section>
      )}

      {todo.length > 0 && (
        <Section title="Требует внимания">
          <ul className="space-y-2 text-sm">
            {todo.map((t) => (
              <li key={t.href + t.text}>
                <Link href={t.href} className="flex items-center justify-between gap-4 rounded-xl bg-amber-50 px-4 py-3 text-amber-900 hover:bg-amber-100">
                  {t.text} <span aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
