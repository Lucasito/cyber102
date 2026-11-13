import { CATEGORY_STYLE, DEFAULT_STYLE, formatDistance, illustrationFor, type CardEvent } from "@/lib/format";
import { categoryName, dayPartsL, formatPriceL, statusLabel, tr, type Lang } from "@/lib/i18n";

/**
 * Карточка события. На телефоне — компактная строка с миниатюрой, с sm — плитка.
 * Без фото — иллюстрация на спокойной подложке категории.
 */
export function EventCard({
  event: e,
  target,
  tile = false,
  row: compact = false,
  lang = "ru",
  accent = false,
}: {
  event: CardEvent;
  target?: string;
  tile?: boolean;
  row?: boolean;
  lang?: Lang;
  /** Виджет: цвет --brand заметен — полоса у карточки, дата и цена */
  accent?: boolean;
}) {
  // Идёт прямо сейчас. Многодневное (выставка) — показываем дату окончания «до 11 дек»; короткое — свою дату
  const now = new Date();
  const live = !!e.endsAt && new Date(e.startsAt) < now && new Date(e.endsAt) > now;
  const ongoing = live && new Date(e.endsAt!).getTime() - new Date(e.startsAt).getTime() > 86_400_000;
  const d = dayPartsL(e.startsAt, lang);
  const shown = ongoing ? dayPartsL(e.endsAt!, lang) : d;
  const status = statusLabel(e.status, lang);
  const inactive = e.status === "CANCELLED" || e.status === "PAST";
  const style = CATEGORY_STYLE[e.category?.slug ?? ""] ?? DEFAULT_STYLE;
  // tile — всегда плитка (виджет); row — всегда строка (чат); иначе строка на телефоне и плитка с sm
  const row = tile ? "" : compact ? "flex-row items-stretch" : "max-sm:flex-row max-sm:items-stretch";
  const stripe = accent ? (tile ? "border-t-4 border-[var(--brand)]" : "border-l-4 border-[var(--brand)]") : "";
  const accentText = accent ? "text-[var(--brand)]" : "text-stone-900";
  return (
    <a
      href={`/events/${e.id}`}
      target={target}
      className={`group flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-black/5 transition hover:shadow-lg hover:shadow-black/5 sm:hover:-translate-y-0.5 ${row} ${stripe} ${inactive ? "opacity-55" : ""}`}
    >
      <div className={`relative shrink-0 overflow-hidden ${style} ${tile ? "aspect-[16/9]" : compact ? "w-24" : "aspect-[16/9] max-sm:aspect-auto max-sm:w-24"}`}>
        {e.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- внешние картинки источников, домены заранее неизвестны
          <img src={e.imageUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- локальная SVG-иллюстрация без растровой оптимизации
          <img src={illustrationFor(e.category?.slug)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div
          className={`absolute flex flex-col items-center rounded-xl bg-white/95 px-2.5 py-1.5 leading-none text-stone-900 shadow-sm ${tile ? "top-3 left-3" : compact ? "top-2.5 left-1/2 -translate-x-1/2 px-2 py-1" : "top-3 left-3 max-sm:top-2.5 max-sm:left-1/2 max-sm:-translate-x-1/2 max-sm:px-2 max-sm:py-1"}`}
        >
          {ongoing && lang === "ru" && <span className="mb-0.5 text-[10px] text-stone-500">{tr(lang, "until")}</span>}
          <span className={`text-lg font-semibold tabular-nums ${accent ? "text-[var(--brand)]" : ""}`}>{shown.day}</span>
          <span className="mt-0.5 text-[11px] text-stone-500 uppercase">{shown.month}</span>
          {ongoing && lang === "ba" && <span className="mt-0.5 text-[10px] text-stone-500">{tr(lang, "until")}</span>}
        </div>
      </div>
      <div className={`flex min-w-0 flex-1 flex-col gap-1 p-4 ${compact ? "py-3" : "max-sm:py-3"}`}>
        <div className="flex items-center gap-2 text-xs text-stone-500">
          {e.category && <span className="font-medium text-[var(--brand)]">{categoryName(e.category.slug, e.category.name, lang)}</span>}
          <span>{ongoing ? tr(lang, "live") : live ? tr(lang, "liveUntil", { time: dayPartsL(e.endsAt!, lang).time }) : `${d.weekday}, ${d.time}`}</span>
          {e.ageLimit != null && <span className="ml-auto rounded border border-stone-300 px-1 text-[11px]">{e.ageLimit}+</span>}
        </div>
        <h3 className="line-clamp-2 font-semibold leading-snug text-stone-900 group-hover:text-[var(--brand)]">{e.title}</h3>
        {e.venue && (
          <p className="line-clamp-1 text-sm text-stone-500">
            {e.venue.name}, {e.venue.city}
            {e.distanceKm != null && <span className="font-medium text-[var(--brand)]"> · {formatDistance(e.distanceKm)}</span>}
          </p>
        )}
        <p className={`mt-auto flex items-center gap-2 pt-1.5 text-sm font-semibold ${accentText}`}>
          {formatPriceL(e, lang)}
          {status && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{status}</span>}
        </p>
      </div>
    </a>
  );
}

export function EventGrid({ events, target, lang = "ru" }: { events: CardEvent[]; target?: string; lang?: Lang }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
      {events.map((e) => (
        <EventCard key={e.id} event={e} target={target} lang={lang} />
      ))}
    </div>
  );
}
