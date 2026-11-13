import { EventCard } from "@/components/event-card";
import { toCard } from "@/lib/format";
import { DEMO_SOURCE } from "@/lib/demo-data";
import { db } from "@/lib/server/db";
import { datePresets, localDay, parseEventFilter, searchEvents } from "@/lib/server/events";
import { getSettings } from "@/lib/server/settings";
import { HeightReporter } from "./height-reporter";

export const dynamic = "force-dynamic";

/** Период виджета считается в момент показа: «выходные» всегда ближайшие, а не те, что были при настройке. */
function periodDates(period: string | undefined) {
  const p = datePresets();
  switch (period) {
    case "today":
    case "tomorrow":
    case "weekend":
      return p[period];
    case "week":
      return { dateFrom: localDay(0), dateTo: localDay(6) };
    case "month":
      return { dateFrom: localDay(0), dateTo: localDay(30) };
    default:
      return {};
  }
}

/**
 * Виджет для встраивания (iframe) на сторонние сайты. Параметры — см. конструктор /docs/widget и public/widget.js.
 * Фильтры — те же, что у API; оформление: layout (grid|list), title, accent (цвет без #), link=0 (без ссылки на афишу).
 */
export default async function Widget({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { period, layout, title, accent, link, wid, ...sp } = await searchParams;
  const parsed = parseEventFilter({ limit: "6", ...sp, ...periodDates(period) });
  const result = parsed.success ? await searchEvents(parsed.data) : { items: [] };
  const base = process.env.PUBLIC_URL ?? "";
  const demo = (await getSettings("site")).testBanner && (await db.event.count({ where: { sources: { some: { source: DEMO_SOURCE } } }, take: 1 })) > 0;
  const color = /^[0-9a-f]{6}$/i.test(accent ?? "") ? `#${accent}` : undefined;
  const list = layout === "list";
  return (
    <main className="p-2" style={color ? ({ "--brand": color } as React.CSSProperties) : undefined}>
      {wid && <HeightReporter wid={wid.slice(0, 40)} />}
      {title && <h2 className="mb-2 border-l-4 border-[var(--brand)] pl-2 text-lg font-semibold text-[var(--brand)]">{title.slice(0, 120)}</h2>}
      {demo && <p className="mb-2 rounded-lg bg-amber-100 px-3 py-1.5 text-center text-xs text-amber-900">Тестовые данные — события условные</p>}
      {result.items.length ? (
        <div className={list ? "grid gap-2" : "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]"}>
          {result.items.map((e) => (
            <EventCard key={e.id} event={toCard(e)} target="_blank" tile={!list} row={list} accent />
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-stone-500">Подходящих событий пока нет</p>
      )}
      {link !== "0" && (
        <a href={`${base}/`} target="_blank" rel="noopener" className="mt-3 block text-center text-sm font-medium text-[var(--brand)] hover:underline">
          Вся афиша культуры Башкортостана →
        </a>
      )}
      <p className="mt-2 text-center text-[11px] text-stone-400">Неофициальный сервис. Данные — из открытых источников, у каждого события есть ссылка на источник.</p>
    </main>
  );
}
