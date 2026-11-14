import { EventCard } from "@/components/event-card";
import { groupSessions, toCard } from "@/lib/format";
import { datePresets, localDay, parseEventFilter, searchEvents } from "@/lib/server/events";

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

const HEX = /^[0-9a-f]{6}$/i;
const FONTS: Record<string, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

/**
 * Виджет для встраивания (iframe) на сторонние сайты. Параметры — см. конструктор /docs/widget и public/widget.js.
 * Фильтры — те же, что у API. Оформление:
 *   layout   grid | list            плитки или список
 *   cols     1–4                    максимум колонок плиток (на узком экране меньше)
 *   img      0                      без картинок — компактные карточки
 *   theme    dark                   тёмные карточки для тёмного сайта
 *   bg       transparent | white | hex  фон фрейма (по умолчанию прозрачный — виден фон сайта)
 *   radius   0–24                   скругление карточек, px
 *   font     system | serif         шрифт (по умолчанию Inter)
 *   accent   hex без #              цвет акцентов
 *   title, link=0                   заголовок, без ссылки «Вся афиша»
 */
export default async function Widget({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { period, layout, title, accent, link, wid, cols, img, theme, bg, radius, font, ...sp } = await searchParams;
  // Показы одного события сводятся в карточку — берём с запасом, чтобы карточек было сколько просили
  const limit = Math.min(Math.max(Number(sp.limit) || 6, 1), 30);
  const parsed = parseEventFilter({ ...sp, limit: String(Math.min(limit * 3, 90)), ...periodDates(period) });
  const result = parsed.success ? await searchEvents(parsed.data) : { items: [] };
  const items = groupSessions(result.items.map(toCard)).slice(0, limit);
  const base = process.env.PUBLIC_URL ?? "";
  const list = layout === "list";
  const dark = theme === "dark";
  // Зелёный афиши на тёмных карточках не читается — для тёмной темы без своего цвета берём светлый
  const color = HEX.test(accent ?? "") ? `#${accent}` : dark ? "#3ecf8e" : undefined;
  const background = bg === "white" ? (dark ? "#1c1917" : "#ffffff") : HEX.test(bg ?? "") ? `#${bg}` : "transparent";
  const r = radius != null && radius !== "" ? Math.min(Math.max(Number(radius) || 0, 0), 24) : null;
  const n = Math.min(Math.max(Number(cols) || 0, 0), 4);
  const fontFamily = FONTS[font ?? ""];
  // Стили фрейма: фон документа (по умолчанию прозрачный), тёмная тема и скругление — поверх классов карточки
  const css = [
    `html,body{background:${background}!important}`,
    fontFamily ? `.afw{font-family:${fontFamily}}` : "",
    r != null ? `.afw .rounded-2xl{border-radius:${r}px}.afw .rounded-xl{border-radius:${Math.min(r, 12)}px}` : "",
    dark
      ? `.afw-dark .bg-white{background:#292524}.afw-dark .text-stone-900,.afw-dark h2,.afw-dark h3{color:#f5f5f4}` +
        `.afw-dark .text-stone-500{color:#a8a29e}.afw-dark .text-stone-700{color:#d6d3d1}` +
        `.afw-dark .ring-black\\/5{--tw-ring-color:rgb(255 255 255/.1)}.afw-dark .border-stone-300{border-color:#57534e}` +
        `.afw-dark .bg-white\\/95{background:rgb(255 255 255/.95)}.afw-dark .bg-white\\/95 .text-stone-500{color:#78716c}`
      : "",
  ].join("");
  const gridStyle = !list && n ? { gridTemplateColumns: `repeat(auto-fill, minmax(max(200px, calc((100% - ${(n - 1) * 12}px) / ${n})), 1fr))` } : undefined;
  return (
    <main
      className={`afw p-2 ${dark ? "afw-dark text-stone-100" : ""}`}
      style={{ ...(color ? { "--brand": color } : {}), colorScheme: dark ? "dark" : "light" } as React.CSSProperties}
    >
      <style>{css}</style>
      {wid && <HeightReporter wid={wid.slice(0, 40)} />}
      {title && <h2 className="mb-2 border-l-4 border-[var(--brand)] pl-2 text-lg font-semibold text-[var(--brand)]">{title.slice(0, 120)}</h2>}
      {items.length ? (
        <div className={list ? "grid gap-2" : "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]"} style={gridStyle}>
          {items.map((e) => (
            <EventCard key={e.id} event={e} target="_blank" tile={!list} row={list} accent ageNote={!!sp.age} image={img !== "0"} />
          ))}
        </div>
      ) : (
        <p className={`py-8 text-center text-sm ${dark ? "text-stone-400" : "text-stone-500"}`}>Подходящих событий пока нет</p>
      )}
      {link !== "0" && (
        <a href={`${base}/`} target="_blank" rel="noopener" className="mt-3 block text-center text-sm font-medium text-[var(--brand)] hover:underline">
          Вся афиша культуры Башкортостана →
        </a>
      )}
      <p className={`mt-2 text-center text-[11px] ${dark ? "text-stone-400" : "text-stone-500"}`}>
        Неофициальный сервис. Данные — из открытых источников, у каждого события есть ссылка на источник.
      </p>
    </main>
  );
}
