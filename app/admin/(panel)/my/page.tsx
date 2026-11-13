import Link from "next/link";
import { PageTitle, Section, Stat } from "@/components/admin/blocks";
import { ActionButton } from "@/components/admin/ui";
import { withdrawEvent } from "@/app/admin/organizer-actions";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";

type Ev = { publication: string; needsReview: boolean; reviewNote: string | null };

/** Статус события для организатора — простыми словами. */
function statusOf(e: Ev): [string, string] {
  if (e.publication === "PUBLISHED") return ["опубликовано", "text-emerald-700"];
  if (e.needsReview) return ["на модерации", "text-amber-700"];
  if (e.reviewNote?.startsWith("отклонено")) return ["отклонено", "text-red-700"];
  return ["черновик", "text-stone-500"];
}

/** Кабинет организатора: свои события и их статус. */
export default async function MyEvents() {
  const me = await requireAdmin("ORGANIZER");
  const events = await db.event.findMany({
    where: { createdById: me.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, title: true, startsAt: true, publication: true, needsReview: true, reviewNote: true, venue: { select: { name: true, city: true } } },
  });
  const count = (s: string) => events.filter((e) => statusOf(e)[0] === s).length;
  return (
    <>
      <PageTitle
        title="Мои события"
        desc={
          <>
            События, которые вы добавили. Каждое проверяет модератор — после этого оно появляется в афише, ботах и виджетах. Публикуете афишу на своём сайте?
            Подключите{" "}
            <Link href="/docs/format" className="underline">
              ленту в универсальном формате
            </Link>{" "}
            — события будут попадать в афишу сами.
          </>
        }
      />
      <div className="flex flex-wrap gap-3">
        <Link href="/admin/my/new" className="inline-flex rounded-full bg-stone-900 px-5 py-2 text-sm font-medium text-white hover:bg-stone-700">
          Добавить событие
        </Link>
        <Link href="/admin/my/import" className="inline-flex rounded-full bg-white px-5 py-2 text-sm font-medium ring-1 ring-black/10 hover:ring-black/30">
          Загрузить файл
        </Link>
      </div>
      <Section>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="на модерации" value={count("на модерации")} />
          <Stat label="опубликовано" value={count("опубликовано")} />
          <Stat label="отклонено" value={count("отклонено")} />
        </div>
      </Section>
      <Section>
        {events.length ? (
          <ul className="divide-y divide-black/5">
            {events.map((e) => {
              const [label, tone] = statusOf(e);
              return (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                  <div className="min-w-0">
                    {e.publication === "PUBLISHED" ? (
                      <Link href={`/events/${e.id}`} className="font-medium hover:underline">
                        {e.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{e.title}</span>
                    )}
                    <div className="text-xs text-stone-500">
                      {e.startsAt.toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                      {e.venue && ` · ${e.venue.name}, ${e.venue.city}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className={tone}>{label}</span>
                    {e.publication !== "PUBLISHED" && (
                      <ActionButton action={withdrawEvent.bind(null, e.id)} confirm={`Отозвать «${e.title}»?`}>
                        Отозвать
                      </ActionButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Пока ничего нет. Добавьте событие или загрузите файл со списком.</p>
        )}
      </Section>
    </>
  );
}
