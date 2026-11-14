import Link from "next/link";
import { redirect } from "next/navigation";
import { PageTitle, Section, Stat } from "@/components/admin/blocks";
import { aiProviderName } from "@/lib/server/ai";
import { requireAdmin } from "@/lib/server/admin";
import { analyticsSummary } from "@/lib/server/analytics";
import { db } from "@/lib/server/db";
import { getSettings } from "@/lib/server/settings";

/** Обзор: главные цифры и что требует внимания. Подробности — в разделах меню. */
export default async function AdminOverview() {
  const me = await requireAdmin("ORGANIZER");
  // Организатору — сразу его события
  if (me.role === "ORGANIZER") redirect("/admin/my");
  const now = new Date();
  const [total, upcoming, sources, cancelled, users, review, feedback] = await Promise.all([
    db.event.count(),
    db.event.count({ where: { status: { notIn: ["PAST", "CANCELLED"] }, OR: [{ startsAt: { gte: now } }, { endsAt: { gte: now } }] } }),
    db.source.count({ where: { enabled: true } }),
    db.event.count({ where: { status: "CANCELLED", startsAt: { gte: now } } }),
    db.botUser.groupBy({ by: ["platform"], _count: true }),
    db.event.count({ where: { needsReview: true, status: { not: "PAST" } } }),
    db.feedback.count({ where: { status: "new" } }),
  ]);
  const botUsers = (p: string) => users.find((u) => u.platform === p)?._count ?? 0;

  const isAdmin = me.role === "ADMIN";
  const [provider, ai, max, tg, stats] = isAdmin
    ? await Promise.all([aiProviderName(), getSettings("ai"), getSettings("max"), getSettings("telegram"), getSettings("tuning").then((t) => analyticsSummary(t.analyticsDays))])
    : [null, null, null, null, null];

  // Что требует внимания администратора — со ссылкой на нужный раздел
  const todo: { text: string; href: string }[] = [];
  if (feedback) todo.push({ text: `${feedback} новых обращений: заявки организаторов, уточнения, вопросы`, href: "/admin/feedback" });
  if (review) todo.push({ text: `${review} спорных карточек ждут модерации — на сайте их не видно`, href: "/admin/moderation" });
  const applications = await db.adminUser.count({ where: { pendingApproval: true } });
  if (applications) todo.push({ text: `${applications} заявок организаторов ждут решения`, href: "/admin/organizers" });
  if (!sources) todo.push({ text: "Ни один источник не включён — новые события сами не появятся", href: "/admin/sources" });
  if (isAdmin) {
    if (!ai?.enabled || !provider) todo.push({ text: "ИИ-помощник выключен или не настроен — работает обычный поиск по правилам", href: "/admin/ai" });
    if (!max?.enabled && !tg?.enabled) todo.push({ text: "Ни один бот не включён", href: "/admin/bots" });
  }

  return (
    <>
      <PageTitle title={`Здравствуйте, ${me.login}`} desc={isAdmin ? "Состояние афиши и что стоит проверить." : "Ваша роль — модератор: события, модерация, импорт и журнал — в меню слева."} />
      <Section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="актуальных событий" value={upcoming} />
          <Stat label="всего в базе" value={total} />
          <Stat label="отменённых впереди" value={cancelled} tone={cancelled ? "warn" : undefined} />
          <Stat label="источников включено" value={sources} tone={sources ? undefined : "warn"} />
        </div>
      </Section>

      <Link href="/admin/quality" className="block rounded-2xl bg-white px-5 py-4 text-sm ring-1 ring-black/5 hover:ring-black/20">
        <b>Качество афиши →</b><span className="mt-1 block text-stone-500">Ближайшие события без цены, возраста, точного места или с проблемами источника.</span>
      </Link>

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
