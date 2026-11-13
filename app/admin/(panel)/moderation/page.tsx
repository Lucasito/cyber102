import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { EventBadges, fmtDateTime } from "@/components/admin/event-badges";
import { ActionButton } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { publishEvent, rejectEvent } from "../../events-actions";

/** Очередь модерации: спорные карточки (импорт без категории или цены, сборщик с низкой уверенностью…). */
export default async function AdminModeration() {
  await requireAdmin("MODERATOR");
  const items = await db.event.findMany({
    where: { needsReview: true, status: { not: "PAST" } },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { venue: true, category: true, sources: { take: 3 } },
  });
  return (
    <>
      <PageTitle title="Модерация" desc="Спорные карточки ждут проверки и на сайте не видны. Одобрить — опубликовать; отклонить — оставить черновиком. Поправить поля — в карточке события." />
      <Section>
        {items.length ? (
          <ul className="divide-y divide-black/5">
            {items.map((e) => (
              <li key={e.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link href={`/admin/events/${e.id}`} className="font-medium hover:underline">
                    {e.title}
                  </Link>
                  <EventBadges status={e.status} publication={e.publication} needsReview={e.needsReview} />
                </div>
                <p className="text-sm text-stone-600">
                  {fmtDateTime(e.startsAt)} · {e.venue ? `${e.venue.name}, ${e.venue.city}` : "площадка не указана"} · {e.category?.name ?? "без категории"} ·{" "}
                  {e.priceMin === 0 ? "бесплатно" : e.priceMin != null ? `от ${e.priceMin} ₽` : "цена не указана"}
                </p>
                <p className="text-sm text-amber-800">Почему спорная: {e.reviewNote ?? "требует проверки"}</p>
                <p className="flex flex-wrap gap-x-3 text-xs">
                  {e.sources.map((s) => (
                    <a key={s.id} href={s.url} target="_blank" rel="noreferrer noopener" className="break-all text-[var(--brand)] hover:underline">
                      {s.url}
                    </a>
                  ))}
                </p>
                <div className="flex flex-wrap gap-3">
                  <ActionButton action={publishEvent.bind(null, e.id)}>Одобрить и опубликовать</ActionButton>
                  <ActionButton action={rejectEvent.bind(null, e.id)}>Отклонить</ActionButton>
                  <Link href={`/admin/events/${e.id}`} className="self-center text-sm text-stone-600 hover:underline">
                    Исправить →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Очередь пуста — спорных карточек нет.</p>
        )}
      </Section>
    </>
  );
}
