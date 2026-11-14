import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { fmtDateTime } from "@/components/admin/event-badges";
import { requireAdmin } from "@/lib/server/admin";
import { QUALITY_ISSUES, qualityReport } from "@/lib/server/quality";

export default async function AdminQuality({ searchParams }: { searchParams: Promise<{ issue?: string; q?: string; days?: string; publication?: string; page?: string }> }) {
  await requireAdmin("MODERATOR");
  const report = await qualityReport(await searchParams);
  const { items, counts, total, pages, page, issue, q, days, publication, now } = report;
  const href = (patch: Record<string, string | number>) => {
    const params = new URLSearchParams({ issue, q, days, publication, page: "1" });
    for (const [key, value] of Object.entries(patch)) params.set(key, String(value));
    return `/admin/quality?${params}`;
  };
  const control = "rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-black/10";
  return (
    <>
      <PageTitle title="Качество афиши" desc="Сначала идущие сейчас и ближайшие события. Исправляйте сведения по источнику: нулевая цена и возраст 0+ считаются заполненными." />
      <form action="/admin/quality" className="flex flex-wrap gap-3">
        <input type="hidden" name="issue" value={issue} />
        <label className="min-w-48 flex-1 text-sm">Поиск
          <input className={`${control} mt-1 w-full`} name="q" defaultValue={q} placeholder="Событие, площадка или город" />
        </label>
        <label className="text-sm">Период
          <select className={`${control} mt-1 block`} name="days" defaultValue={days}>
            <option value="7">Ближайшие 7 дней</option><option value="30">Ближайшие 30 дней</option><option value="all">Все предстоящие</option>
          </select>
        </label>
        <label className="text-sm">Публикация
          <select className={`${control} mt-1 block`} name="publication" defaultValue={publication}>
            <option value="published">На сайте</option><option value="draft">Черновики</option><option value="all">Все</option>
          </select>
        </label>
        <button className="self-end rounded-xl bg-stone-900 px-4 py-2 text-sm text-white">Показать</button>
      </form>
      <p className="text-sm text-stone-500">В выборке {counts.total} событий, требуют уточнения {counts.affected}. Одно событие может входить в несколько групп. Прошедшие и отменённые исключены.</p>
      <nav aria-label="Проблемы карточек" className="flex flex-wrap gap-2">
        {Object.entries(QUALITY_ISSUES).map(([key, label]) => <Link key={key} href={href({ issue: key })} aria-current={issue === key ? "page" : undefined} className={`rounded-full px-3 py-2 text-sm ${issue === key ? "bg-stone-900 text-white" : "bg-white ring-1 ring-black/10 hover:ring-black/30"}`}>
          {label} <span className="opacity-60">{key === "all" ? counts.affected : counts[key as keyof typeof counts]}</span>
        </Link>)}
      </nav>
      <Section>
        {items.length ? <ul className="divide-y divide-black/5">{items.map((e) => {
          const ongoing = e.startsAt < now && !!e.endsAt && e.endsAt >= now;
          const issues = [e.missingPrice && "Не указана цена", e.missingAge && "Не указан возраст", e.missingAddress && "Место уточняется", e.missingSource && "Нет ссылки на источник", e.sourceError && "Ошибка проверки источника"].filter(Boolean);
          return <li key={e.id} className="space-y-2 py-4" data-quality-event={e.id}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-500">
              <span>{ongoing ? `Идёт до ${fmtDateTime(e.endsAt!)}` : fmtDateTime(e.startsAt)}</span>
              {e.publication === "DRAFT" && <span className="rounded bg-stone-100 px-2 py-0.5">Черновик</span>}
            </div>
            <Link href={`/admin/events/${e.id}`} className="block font-medium hover:underline">{e.title}</Link>
            <p className="text-sm text-stone-500">{[e.venueName, e.city, e.address].filter(Boolean).join(" · ") || "Площадка не указана"}</p>
            <div className="flex flex-wrap gap-1.5">{issues.map((label) => <span key={String(label)} className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">{label}</span>)}</div>
            <div className="flex flex-wrap gap-4 text-sm">
              <Link href={`/admin/events/${e.id}`} className="text-[var(--brand)] hover:underline">Исправить карточку →</Link>
              {e.missingAddress && e.venueId && <Link href={`/admin/venues?q=${encodeURIComponent(e.venueName ?? "")}`} className="text-[var(--brand)] hover:underline">Уточнить площадку →</Link>}
              {e.sourceError && <Link href="/admin/sources" className="text-[var(--brand)] hover:underline">Результаты сбора →</Link>}
            </div>
          </li>;
        })}</ul> : <p className="text-sm text-stone-500">В этой выборке проблем не найдено.</p>}
        {pages > 1 && <nav className="mt-5 flex items-center justify-between gap-3 text-sm" aria-label="Страницы">
          {page > 1 ? <Link href={href({ page: page - 1 })}>← Назад</Link> : <span />}
          <span className="text-stone-500">{page} из {pages} · всего {total}</span>
          {page < pages ? <Link href={href({ page: page + 1 })}>Дальше →</Link> : <span />}
        </nav>}
      </Section>
      <p className="text-sm text-stone-500">«Место уточняется» — нет адреса, точных координат или площадки. Ошибки источников показаны по последним результатам сборщика; новых сетевых проверок эта страница не выполняет. Успешная загрузка ленты не гарантирует доступность каждой ссылки. Недостающие данные не заполняются автоматически.</p>
    </>
  );
}
