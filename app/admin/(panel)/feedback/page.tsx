import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { fmtDateTime } from "@/components/admin/event-badges";
import { ActionButton } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { FEEDBACK_KINDS } from "@/lib/server/feedback";
import { setFeedbackStatus } from "../../events-actions";

/** Обращения с сайта и через API: заявки организаторов, уточнения по событиям, вопросы. */
export default async function AdminFeedback({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin("MODERATOR");
  const status = (await searchParams).status === "done" ? "done" : "new";
  const [items, counts] = await Promise.all([
    db.feedback.findMany({ where: { status }, orderBy: { createdAt: status === "new" ? "asc" : "desc" }, take: 100 }),
    db.feedback.groupBy({ by: ["status"], _count: true }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const events = new Map(
    (await db.event.findMany({ where: { id: { in: items.map((i) => i.eventId).filter((x): x is string => !!x) } }, select: { id: true, title: true } })).map((e) => [e.id, e.title]),
  );
  return (
    <>
      <PageTitle title="Обращения" desc="Заявки организаторов, уточнения по событиям и вопросы с сайта и через API. Событие из заявки добавляйте вручную или импортом — только с источником." />
      <div className="flex gap-2 text-sm">
        {(["new", "done"] as const).map((s) => (
          <Link key={s} href={s === "new" ? "/admin/feedback" : "/admin/feedback?status=done"} className={`rounded-full px-3 py-1.5 ${s === status ? "bg-stone-900 text-white" : "bg-white ring-1 ring-black/10"}`}>
            {s === "new" ? "Новые" : "Обработанные"} <span className="opacity-60">{count(s)}</span>
          </Link>
        ))}
      </div>
      <Section>
        {items.length ? (
          <ul className="divide-y divide-black/5">
            {items.map((f) => (
              <li key={f.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <b>{FEEDBACK_KINDS[f.kind as keyof typeof FEEDBACK_KINDS] ?? f.kind}</b>
                  <span className="text-stone-500">{fmtDateTime(f.createdAt)}</span>
                  <span className="text-stone-500">{f.source === "api" ? "через API" : "с сайта"}</span>
                  {f.handledBy && <span className="text-stone-500">обработал {f.handledBy}</span>}
                </div>
                {f.eventId && (
                  <p className="text-sm">
                    Событие:{" "}
                    <Link href={`/admin/events/${f.eventId}`} className="text-[var(--brand)] hover:underline">
                      {events.get(f.eventId) ?? "удалено"}
                    </Link>
                  </p>
                )}
                <p className="text-sm whitespace-pre-line">{f.message}</p>
                {(f.name || f.contact) && (
                  <p className="text-sm text-stone-600">
                    {f.name} {f.contact && <>· для ответа: {f.contact}</>}
                  </p>
                )}
                <ActionButton action={setFeedbackStatus.bind(null, f.id, status === "new" ? "done" : "new")}>{status === "new" ? "Обработано" : "Вернуть в новые"}</ActionButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">{status === "new" ? "Новых обращений нет." : "Пока пусто."}</p>
        )}
      </Section>
    </>
  );
}
