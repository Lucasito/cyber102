import { ArrowUpDown, List, Map as MapIcon, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AskBox } from "@/components/ask-box";
import { EventGrid } from "@/components/event-card";
import { NearMeButton } from "@/components/near-me-button";
import { VenueMap, type MapPoint } from "@/components/venue-map";
import { dayParts, toCard } from "@/lib/format";
import { categoryName, dict, examplesBa, tr, type DictKey } from "@/lib/i18n";
import { getLang } from "@/lib/server/lang";
import { datePresets, filterOptions, parseEventFilter, searchEvents, SORT_LABELS } from "@/lib/server/events";
import { DEFAULT_EXAMPLES, getSettings, mapConfig } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

/** Ссылка с изменёнными параметрами (null — убрать параметр). Сброс пагинации при любом изменении фильтра. */
function href(sp: SP, patch: Record<string, string | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, limit: undefined, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/?${s}#events` : "/#events";
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition ${active ? "bg-stone-900 text-white" : "bg-white text-stone-700 ring-1 ring-black/5 hover:ring-black/20"}`}
    >
      {children}
    </Link>
  );
}

/** Ключи словаря для вариантов сортировки. */
const SORT_KEYS = { date: "sortDate", price_asc: "sortCheap", price_desc: "sortExpensive", new: "sortNew", distance: "sortNear" } as const satisfies Record<string, DictKey>;

/** Примеры запросов в башкирской версии (тексты из админки — русские). */

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const T = await getSettings("tuning");
  const PAGE = T.pageSize;
  const kids = String(T.kidsAge);
  const t = (k: DictKey) => tr(lang, k);
  const presets = datePresets();
  const limit = Math.min(Number(sp.limit) || PAGE, 96);
  const parsed = parseEventFilter({ ...sp, limit: String(limit) });
  const [result, options, site] = await Promise.all([parsed.success ? searchEvents(parsed.data) : null, filterOptions(), getSettings("site")]);

  // Пусто по фильтрам — какое условие мешает (ТЗ 6.1): снимаем по одному и считаем, сколько найдётся
  const RELAX: [DictKey, Record<string, null>][] = [
    ["relaxDates", { dateFrom: null, dateTo: null }],
    ["relaxCategory", { category: null }],
    ["relaxCity", { city: null }],
    ["relaxPrice", { priceMax: null, free: null }],
    ["relaxAge", { age: null }],
    ["relaxQuery", { q: null }],
    ["relaxPushkin", { pushkin: null }],
    ["relaxAccess", { access: null }],
    ["relaxNear", { near: null, radius: null }],
  ];
  const relax =
    result && !result.items.length
      ? (
          await Promise.all(
            RELAX.filter(([, patch]) => Object.keys(patch).some((k) => sp[k])).map(async ([label, patch]) => {
              const f = parseEventFilter({ ...sp, ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])), limit: "1" });
              const n = f.success ? (await searchEvents(f.data)).total : 0;
              return { label, href: href(sp, patch), n };
            }),
          )
        ).filter((r) => r.n > 0)
      : [];

  const isPreset = (k: keyof typeof presets) => sp.dateFrom === presets[k].dateFrom && sp.dateTo === presets[k].dateTo;
  const dateChip = (k: keyof typeof presets, label: string) => (
    <Chip href={href(sp, isPreset(k) ? { dateFrom: null, dateTo: null } : presets[k])} active={isPreset(k)}>
      {label}
    </Chip>
  );
  const hasFilters = ["q", "city", "category", "dateFrom", "dateTo", "priceMax", "free", "age", "pushkin", "access", "near"].some((k) => sp[k]);
  const mapView = sp.view === "map";
  // Для карты — до 200 событий текущей выборки, сгруппированных по площадкам
  const mapPoints: MapPoint[] = [];
  if (mapView && parsed.success) {
    // На карту — все подходящие события (до 1000), а не одна страница каталога
    const all = await searchEvents({ ...parsed.data, limit: 1000, offset: 0 });
    // Точка — площадка; площадки без точного адреса (центр города) — одна общая точка города «адрес уточняется»
    const byVenue = new Map<string, MapPoint & { more: number }>();
    for (const e of all.items) {
      if (e.venue?.lat == null || e.venue.lon == null) continue;
      const key = e.venue.approx ? `city:${e.venue.city}` : e.venue.id;
      const title = e.venue.approx ? `${e.venue.city} — ${tr(lang, "mapApproxCity")}` : `${e.venue.name}, ${e.venue.city}`;
      const p = byVenue.get(key) ?? { lat: e.venue.lat, lon: e.venue.lon, title, lines: [], more: 0 };
      const d = dayParts(toCard(e).startsAt);
      if (p.lines.length < 6) p.lines.push({ text: `${d.day} ${d.month} — ${e.title}${e.venue.approx ? ` (${e.venue.name})` : ""}`, href: `/events/${e.id}` });
      else p.more++;
      byVenue.set(key, p);
    }
    mapPoints.push(...[...byVenue.values()].map(({ more, ...p }) => (more ? { ...p, lines: [...p.lines, { text: tr(lang, "mapMore", { n: more }) }] } : p)));
  }
  const me = sp.near ? { lat: Number(sp.near.split(",")[0]), lon: Number(sp.near.split(",")[1]) } : null;

  return (
    <main>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 -top-40 h-96 bg-gradient-to-br from-[#1565C0]/15 via-transparent to-[#0B8F5A]/20 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-3xl px-4 pt-12 pb-10 sm:pt-20">
          <h1 className="text-center text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{(lang === "ru" && site.heroTitle) || t("heroTitle")}</h1>
          <p className="mx-auto mt-3 max-w-xl text-center text-stone-600 text-balance sm:text-lg">{(lang === "ru" && site.heroSubtitle) || t("heroSubtitle")}
          </p>
          <div className="mt-8">
            <AskBox
              lang={lang}
              t={dict(lang)}
              ba={lang === "ba" ? (await getSettings("i18n")).ba : undefined}
              chatEvents={T.chatEvents}
              initialQuestion={typeof sp.ask === "string" ? sp.ask.slice(0, 500) : undefined}
              examples={lang === "ba" ? examplesBa() : site.examples.length ? site.examples : DEFAULT_EXAMPLES}
            />
          </div>
        </div>
      </section>

      <section id="events" className="mx-auto max-w-6xl scroll-mt-16 px-4 pb-16">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Chip href={href(sp, { dateFrom: null, dateTo: null })} active={!sp.dateFrom && !sp.dateTo}>
            {t("allDates")}
          </Chip>
          {dateChip("today", t("today"))}
          {dateChip("tomorrow", t("tomorrow"))}
          {dateChip("weekend", t("weekend"))}
          <span className="mx-1 w-px shrink-0 bg-black/10" aria-hidden />
          <Chip href={href(sp, { free: sp.free ? null : "1", priceMax: null })} active={!!sp.free}>
            {t("free")}
          </Chip>
          <Chip href={href(sp, { age: sp.age === kids ? null : kids })} active={sp.age === kids}>
            {t("withKids")}
          </Chip>
          <Chip href={href(sp, { pushkin: sp.pushkin ? null : "1" })} active={!!sp.pushkin}>
            {t("pushkin")}
          </Chip>
          <Chip href={href(sp, { access: sp.access ? null : "wheelchair" })} active={!!sp.access}>
            {t("access")}
          </Chip>
          <Suspense>
            <NearMeButton active={!!sp.near} label={t("nearMe")} errors={{ unsupported: t("geoUnsupported"), denied: t("geoDenied") }} />
          </Suspense>
          {options.categories.length > 0 && <span className="mx-1 w-px shrink-0 bg-black/10" aria-hidden />}
          {options.categories.map((c) => (
            <Chip key={c.id} href={href(sp, { category: sp.category === c.slug ? null : c.slug })} active={sp.category === c.slug}>
              {categoryName(c.slug, c.name, lang)}
            </Chip>
          ))}
        </div>

        <details className="group mt-3" open={!!(sp.city || sp.priceMax || sp.q || (sp.dateFrom && !Object.keys(presets).some((k) => isPreset(k as keyof typeof presets))))}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal className="size-4" /> {t("moreFilters")}
          </summary>
          <form action="/" className="mt-3 grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-black/5 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
            {sp.category && <input type="hidden" name="category" value={sp.category} />}
            {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
            {sp.free && <input type="hidden" name="free" value={sp.free} />}
            {sp.age && <input type="hidden" name="age" value={sp.age} />}
            {sp.pushkin && <input type="hidden" name="pushkin" value={sp.pushkin} />}
            {sp.access && <input type="hidden" name="access" value={sp.access} />}
            {sp.near && <input type="hidden" name="near" value={sp.near} />}
            {sp.view && <input type="hidden" name="view" value={sp.view} />}
            <label className="sr-only" htmlFor="f-q">{t("qPlaceholder")}</label>
            <input id="f-q" name="q" defaultValue={sp.q} placeholder={t("qPlaceholder")} className="rounded-xl bg-stone-100 px-3 py-2.5 outline-none focus:ring-2 focus:ring-[var(--brand)]" />
            <label className="sr-only" htmlFor="f-city">{t("labelCity")}</label>
            <select id="f-city" name="city" defaultValue={sp.city ?? ""} className="rounded-xl bg-stone-100 px-3 py-2.5 outline-none focus:ring-2 focus:ring-[var(--brand)]">
              <option value="">{t("allCities")}</option>
              {options.cities.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="f-from">{t("labelFrom")}</label>
            <input id="f-from" name="dateFrom" type="date" defaultValue={sp.dateFrom} className="rounded-xl bg-stone-100 px-3 py-2.5 outline-none focus:ring-2 focus:ring-[var(--brand)]" />
            <label className="sr-only" htmlFor="f-to">{t("labelTo")}</label>
            <input id="f-to" name="dateTo" type="date" defaultValue={sp.dateTo} className="rounded-xl bg-stone-100 px-3 py-2.5 outline-none focus:ring-2 focus:ring-[var(--brand)]" />
            <label className="sr-only" htmlFor="f-price">{t("labelPrice")}</label>
            <input id="f-price" name="priceMax" type="number" min={0} step={100} defaultValue={sp.priceMax} placeholder={t("priceTo")} className="rounded-xl bg-stone-100 px-3 py-2.5 outline-none focus:ring-2 focus:ring-[var(--brand)]" />
            <button className="rounded-xl bg-stone-900 px-5 py-2.5 font-medium text-white hover:bg-stone-700">{t("show")}</button>
          </form>
        </details>

        <div className="mt-6 mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">{hasFilters ? t("found") : t("upcoming")}</h2>
          {result && <span className="text-sm text-stone-500">{result.total.toLocaleString("ru-RU")}</span>}
          {hasFilters && (
            <Link href="/#events" scroll={false} className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900">
              <X className="size-4" /> {t("reset")}
            </Link>
          )}
          <div className="flex shrink-0 rounded-full bg-black/5 p-0.5 text-sm sm:order-last" role="group" aria-label="Вид">
            {[
              [null, t("viewList"), List],
              ["map", t("viewMap"), MapIcon],
            ].map(([v, label, Icon]) => {
              const active = (sp.view ?? null) === v;
              const I = Icon as typeof List;
              return (
                <Link
                  key={String(label)}
                  href={href(sp, { view: v as string | null })}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition ${active ? "bg-white font-medium shadow-sm" : "text-stone-500 hover:text-stone-900"}`}
                >
                  <I className="size-3.5" /> {String(label)}
                </Link>
              );
            })}
          </div>
          <nav aria-label="Сортировка" className="no-scrollbar -mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 sm:mx-0 sm:ml-auto sm:w-auto sm:px-0">
            <ArrowUpDown className="mt-1.5 mr-1 size-4 shrink-0 text-stone-400" aria-hidden />
            {(sp.near ? (["distance", ...Object.keys(SORT_LABELS)] as const) : (Object.keys(SORT_LABELS) as (keyof typeof SORT_LABELS)[])).map((key) => {
              const active = (sp.sort ?? "date") === key;
              return (
                <Link
                  key={key}
                  href={href(sp, { sort: key === "date" ? null : key })}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={`shrink-0 rounded-full px-3 py-1 text-sm transition ${active ? "bg-white font-medium text-stone-900 ring-1 ring-black/10" : "text-stone-500 hover:text-stone-900"}`}
                >
                  {t(SORT_KEYS[key as keyof typeof SORT_KEYS])}
                </Link>
              );
            })}
          </nav>
        </div>

        {!result ? (
          <p className="text-red-600">{t("badFilter")}</p>
        ) : mapView ? (
          mapPoints.length ? (
            <VenueMap points={mapPoints} me={me} config={await mapConfig()} className="h-[70vh] min-h-96" />
          ) : (
            <p className="rounded-2xl border border-dashed border-black/15 px-6 py-14 text-center text-stone-500">{t("mapEmpty")}</p>
          )
        ) : result.items.length ? (
          <>
            <EventGrid events={result.items.map(toCard)} lang={lang} ageNote={!!sp.age} />
            {result.total > result.items.length && (
              <div className="mt-8 text-center">
                <Link
                  href={href(sp, { limit: String(limit + PAGE) })}
                  scroll={false}
                  className="inline-block rounded-full bg-white px-6 py-2.5 font-medium ring-1 ring-black/10 hover:ring-black/30"
                >
                  {t("showMore")}
                </Link>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-black/15 px-6 py-14 text-center">
            <p className="font-medium">{hasFilters ? t("nothingFound") : t("emptyAfisha")}</p>
            <p className="mt-1 text-sm text-stone-500">{hasFilters ? (relax.length ? t("relaxLead") : t("nothingHint")) : t("emptyHint")}</p>
            {relax.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {relax.map((r) => (
                  <Link key={r.label} href={r.href} scroll={false} className="rounded-full bg-white px-3.5 py-1.5 text-sm ring-1 ring-black/10 hover:ring-black/30">
                    {t(r.label)} — {r.n}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
