import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { EventBadges, fmtDateTime } from "@/components/admin/event-badges";
import { ActionButton } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { scanDuplicates } from "@/lib/server/dedup";
import { markDistinct, mergeDuplicate, publishEvent, rejectEvent } from "../../events-actions";

type Brief = { id: string; title: string; startsAt: Date; publication: string; venue: { name: string; city: string } | null; sources: { source: string; url: string }[] };

/** Короткая карточка события для сравнения дублей. */
function Card({ e, label }: { e: Brief; label?: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-stone-50 p-3 text-sm">
      {label && <p className="mb-1 text-xs text-stone-500">{label}</p>}
      <Link href={`/admin/events/${e.id}`} className="font-medium hover:underline">
        {e.title}
      </Link>
      <p className="text-stone-600">
        {fmtDateTime(e.startsAt)} · {e.venue ? `${e.venue.name}, ${e.venue.city}` : "площадка не указана"} ·{" "}
        {e.publication === "PUBLISHED" ? "опубликовано" : "черновик"}
      </p>
      <p className="text-xs text-stone-500">источники: {e.sources.map((s) => s.source).join(", ") || "—"}</p>
    </div>
  );
}

/** Очередь модерации: спорные карточки (разбор ИИ, организаторы, возможные дубли, импорт без категории или цены…). */
export default async function AdminModeration() {
  await requireAdmin("MODERATOR");
  const brief = { venue: { select: { name: true, city: true } }, sources: { select: { source: true, url: true }, take: 3 } } as const;
  const items = await db.event.findMany({
    where: { needsReview: true, status: { not: "PAST" } },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { venue: true, category: true, sources: { take: 3 } },
  });
  const originalIds = items.map((e) => e.possibleDuplicateId).filter((x): x is string => !!x);
  const originals = new Map(
    (originalIds.length ? await db.event.findMany({ where: { id: { in: originalIds } }, select: { id: true, title: true, startsAt: true, publication: true, ...brief } }) : []).map((o) => [o.id, o]),
  );
  // Похожие пары по всей афише, кроме уже показанных в очереди
  const shown = new Set(items.filter((e) => e.possibleDuplicateId).map((e) => [e.id, e.possibleDuplicateId].sort().join("|")));
  const pairs = (await scanDuplicates(30)).filter((p) => !shown.has([p.a.id, p.b.id].sort().join("|")));
  return (
    <>
      <PageTitle
        title="Модерация"
        desc="Спорные карточки ждут проверки и на сайте не видны. Одобрить — опубликовать; отклонить — оставить черновиком. Поправить поля — в карточке события. Похожие события из разных источников — объединить в одну карточку."
      />
      <Section>
        {items.length ? (
          <ul className="divide-y divide-black/5">
            {items.map((e) => {
              const orig = e.possibleDuplicateId ? originals.get(e.possibleDuplicateId) : undefined;
              return (
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
                  {orig && (
                    <div className="space-y-2 rounded-xl border border-amber-200 p-3">
                      <p className="text-sm font-medium text-amber-900">Похоже на событие из другого источника:</p>
                      <Card e={orig} />
                      <div className="flex flex-wrap gap-3">
                        <ActionButton action={mergeDuplicate.bind(null, orig.id, e.id)}>Это одно событие — объединить</ActionButton>
                        <ActionButton action={markDistinct.bind(null, e.id, orig.id)}>Разные события</ActionButton>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <ActionButton action={publishEvent.bind(null, e.id)}>Одобрить и опубликовать</ActionButton>
                    <ActionButton action={rejectEvent.bind(null, e.id)}>Отклонить</ActionButton>
                    <Link href={`/admin/events/${e.id}`} className="self-center text-sm text-stone-600 hover:underline">
                      Исправить →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Очередь пуста — спорных карточек нет.</p>
        )}
      </Section>

      <Section
        title={`Возможные дубли в афише${pairs.length ? ` — ${pairs.length}` : ""}`}
        desc="Похожие события одного города с началом в пределах 30 минут: ядро названия совпадает (без «спектакль», возраста, перевода). «Объединить» оставляет выбранную карточку: ссылки на источники, пустые поля и напоминания переходят к ней."
      >
        {pairs.length ? (
          <ul className="divide-y divide-black/5">
            {pairs.map((p) => (
              <li key={`${p.a.id}-${p.b.id}`} className="space-y-2 py-4">
                <p className={`text-xs ${p.level === "same" ? "text-red-700" : "text-amber-700"}`}>
                  {p.level === "same" ? "почти наверняка одно событие" : "похожи"} · совпадение названий {Math.round(p.score * 100)} %
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Card e={p.a} label="1" />
                  <Card e={p.b} label="2" />
                </div>
                <div className="flex flex-wrap gap-3">
                  <ActionButton action={mergeDuplicate.bind(null, p.a.id, p.b.id)}>Объединить, оставить 1</ActionButton>
                  <ActionButton action={mergeDuplicate.bind(null, p.b.id, p.a.id)}>Объединить, оставить 2</ActionButton>
                  <ActionButton action={markDistinct.bind(null, p.a.id, p.b.id)}>Разные события</ActionButton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Похожих пар не найдено.</p>
        )}
      </Section>
    </>
  );
}
