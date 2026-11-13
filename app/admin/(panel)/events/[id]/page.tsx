import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle, Section } from "@/components/admin/blocks";
import { AuditList } from "@/components/admin/audit-list";
import { EventBadges, fmtDateTime } from "@/components/admin/event-badges";
import { EventForm } from "@/components/admin/event-form";
import { ActionButton } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { cancelEvent, deleteEvent, publishEvent, rejectEvent, unpublishEvent } from "../../../events-actions";

const SOURCE_TYPE: Record<string, string> = { MANUAL: "ручной ввод", IMPORT: "импорт", RSS: "RSS", API: "API", PAGE: "страница" };

export default async function AdminEvent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  await requireAdmin("MODERATOR");
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const [e, categories, cities, history, raw] = await Promise.all([
    db.event.findUnique({ where: { id }, include: { venue: true, category: true, sources: { orderBy: { fetchedAt: "asc" } } } }),
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.venue.findMany({ distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } }),
    db.auditLog.findMany({ where: { entity: "event", entityId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.rawRecord.findMany({ where: { eventId: id }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  if (!e) notFound();
  const live = e.publication === "PUBLISHED";

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/admin/events">← События</Link>
      </p>
      <PageTitle title={e.title} desc={<EventBadges status={e.status} publication={e.publication} needsReview={e.needsReview} />} />
      {created && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Событие создано.</p>}
      {e.needsReview && (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          <b>Спорная карточка:</b> {e.reviewNote ?? "требует проверки"}. Проверьте поля и источник, затем одобрите — карточка появится на сайте.
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {e.needsReview ? (
          <>
            <ActionButton action={publishEvent.bind(null, e.id)}>Одобрить и опубликовать</ActionButton>
            <ActionButton action={rejectEvent.bind(null, e.id)}>Отклонить</ActionButton>
          </>
        ) : live ? (
          <ActionButton action={unpublishEvent.bind(null, e.id)}>Снять с публикации</ActionButton>
        ) : (
          <ActionButton action={publishEvent.bind(null, e.id)}>Опубликовать</ActionButton>
        )}
        {e.status !== "CANCELLED" && e.status !== "PAST" && (
          <ActionButton action={cancelEvent.bind(null, e.id)} confirm="Отменить событие? Оно исчезнет из выдачи, по прямой ссылке будет видно с пометкой «отменено».">
            Отменить событие
          </ActionButton>
        )}
        <ActionButton action={deleteEvent.bind(null, e.id)} confirm="Удалить событие совсем? Лучше отменить или снять с публикации — тогда останется история.">
          Удалить
        </ActionButton>
        {live && (
          <Link href={`/events/${e.id}`} target="_blank" className="self-center text-sm text-stone-600 underline-offset-2 hover:underline">
            Открыть на сайте ↗
          </Link>
        )}
      </div>

      <Section>
        <EventForm event={e} categories={categories} cities={cities.map((c) => c.city)} />
      </Section>

      <Section title="Источники" desc="Откуда взято событие. Одно событие из разных источников — одна карточка.">
        <ul className="space-y-2 text-sm">
          {e.sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <a href={s.url} target="_blank" rel="noreferrer noopener" className="break-all text-[var(--brand)] underline-offset-2 hover:underline">
                {s.url}
              </a>
              <span className="text-stone-500">
                {s.source} · {SOURCE_TYPE[s.sourceType] ?? s.sourceType} · {fmtDateTime(s.fetchedAt)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-stone-500">
          Проверено: {fmtDateTime(e.verifiedAt)}
          {e.confidence != null && ` · уверенность ${Math.round(e.confidence * 100)} %`}
          {e.originalStartsAt && ` · прежняя дата: ${fmtDateTime(e.originalStartsAt)}`}
        </p>
        {raw.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-stone-600">Исходные записи источника ({raw.length})</summary>
            {raw.map((r) => (
              <pre key={r.id} className="mt-2 overflow-x-auto rounded-xl bg-stone-100 p-3 text-xs">
                {JSON.stringify(r.payload, null, 2)}
              </pre>
            ))}
          </details>
        )}
      </Section>

      <Section title="История изменений">
        <AuditList items={history} />
      </Section>
    </>
  );
}
