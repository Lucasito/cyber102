import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { EventBadges, fmtDateTime } from "@/components/admin/event-badges";
import type { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";

const PAGE = 30;

const VIEWS: Record<string, { label: string; where: Prisma.EventWhereInput }> = {
  all: { label: "Все", where: {} },
  published: { label: "На сайте", where: { publication: "PUBLISHED", status: { notIn: ["CANCELLED", "PAST"] } } },
  drafts: { label: "Черновики", where: { publication: "DRAFT" } },
  review: { label: "Спорные", where: { needsReview: true } },
  cancelled: { label: "Отменённые", where: { status: "CANCELLED" } },
  past: { label: "Прошедшие", where: { status: "PAST" } },
};

export default async function AdminEvents({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; page?: string; deleted?: string }> }) {
  await requireAdmin("MODERATOR");
  const sp = await searchParams;
  const view = VIEWS[sp.view ?? ""] ? sp.view! : "all";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.EventWhereInput = {
    ...VIEWS[view].where,
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { venue: { name: { contains: q, mode: "insensitive" } } }, { venue: { city: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [items, total, counts] = await Promise.all([
    db.event.findMany({ where, orderBy: { startsAt: view === "past" ? "desc" : "asc" }, take: PAGE, skip: (page - 1) * PAGE, include: { venue: true, category: true, _count: { select: { sources: true } } } }),
    db.event.count({ where }),
    Promise.all(Object.entries(VIEWS).map(async ([k, v]) => [k, await db.event.count({ where: v.where })] as const)),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (p: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    const all = { view, q, page: 1, ...p };
    for (const [k, v] of Object.entries(all)) if (v && !(k === "view" && v === "all") && !(k === "page" && v === 1)) u.set(k, String(v));
    return `/admin/events${u.size ? `?${u}` : ""}`;
  };

  return (
    <>
      <PageTitle title="События" desc="Все карточки: опубликованные, черновики, спорные и отменённые. Отменённое и черновик на сайте не показываются." />
      {sp.deleted && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Событие удалено.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(VIEWS).map(([k, v]) => (
          <Link key={k} href={href({ view: k })} className={`rounded-full px-3 py-1.5 text-sm ${k === view ? "bg-stone-900 text-white" : "bg-white ring-1 ring-black/10 hover:ring-black/30"}`}>
            {v.label} <span className="opacity-60">{counts.find(([c]) => c === k)?.[1]}</span>
          </Link>
        ))}
        <Link href="/admin/events/new" className="ml-auto rounded-full bg-[var(--brand)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">
          + Добавить событие
        </Link>
      </div>
      <form className="flex gap-2" action="/admin/events">
        {view !== "all" && <input type="hidden" name="view" value={view} />}
        <label className="sr-only" htmlFor="q">
          Поиск
        </label>
        <input id="q" name="q" defaultValue={q} placeholder="Название, площадка или город" className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-black/10 outline-none focus:ring-2 focus:ring-[var(--brand)]" />
        <button className="rounded-xl bg-stone-900 px-4 text-sm text-white">Найти</button>
      </form>
      <Section>
        {items.length ? (
          <ul className="divide-y divide-black/5">
            {items.map((e) => (
              <li key={e.id}>
                <Link href={`/admin/events/${e.id}`} className="flex flex-col gap-1 py-3 hover:bg-stone-50 sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-40 shrink-0 text-sm text-stone-500 tabular-nums">{fmtDateTime(e.startsAt)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{e.title}</span>
                    <span className="block truncate text-sm text-stone-500">
                      {e.venue ? `${e.venue.name}, ${e.venue.city}` : "площадка не указана"} · {e.category?.name ?? "без категории"} · источников: {e._count.sources}
                    </span>
                    {e.needsReview && e.reviewNote && <span className="block text-xs text-amber-800">{e.reviewNote}</span>}
                  </span>
                  <EventBadges status={e.status} publication={e.publication} needsReview={e.needsReview} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Ничего не найдено.</p>
        )}
        {pages > 1 && (
          <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Страницы">
            {page > 1 ? <Link href={href({ page: page - 1 })}>← Назад</Link> : <span />}
            <span className="text-stone-500">
              Страница {page} из {pages} · всего {total}
            </span>
            {page < pages ? <Link href={href({ page: page + 1 })}>Дальше →</Link> : <span />}
          </nav>
        )}
      </Section>
    </>
  );
}
