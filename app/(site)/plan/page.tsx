import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarPlus, MapPin, RefreshCw, Route, Users } from "lucide-react";
import { FavoriteButton } from "@/components/favorite-button";
import { ShareButton } from "@/components/share-button";
import { VenueMap, type MapPoint } from "@/components/venue-map";
import { formatDateLongL, tr, type DictKey } from "@/lib/i18n";
import { TZ } from "@/lib/format";
import { planParams } from "@/lib/plan-links";
import { db } from "@/lib/server/db";
import { localDay } from "@/lib/server/events";
import { getLang } from "@/lib/server/lang";
import { defaultPlanDate, planDay, planInputSchema } from "@/lib/server/planner";
import { mapConfig } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "План на день", robots: { index: false, follow: true } };
const field = "mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--brand)]";

export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string" && v !== ""));
  const lang = await getLang(), t = (key: DictKey, values?: Record<string, string | number>) => tr(lang, key, values);
  const parsed = planInputSchema.safeParse({ date: defaultPlanDate(), ...raw });
  const input = parsed.success ? parsed.data : planInputSchema.parse({ date: defaultPlanDate() });
  const cities = (await db.venue.findMany({ distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } })).map((v) => v.city);
  const cityOptions = [...new Set([input.city, ...cities])];
  const requested = Object.keys(raw).length > 0;
  const result = parsed.success && requested ? await planDay(input) : null;
  const items = result?.ok ? result.items : result?.best ?? [];
  const money = (v: number) => `${v.toLocaleString("ru-RU")} ₽`;
  const time = (v: Date) => v.toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const pinned = planParams(input, { keep: items.map((p) => p.event.id), count: Math.max(2, items.length) });
  const points: MapPoint[] = items.flatMap((p, i) => p.event.venue?.lat != null && p.event.venue.lon != null && !p.event.venue.approx ? [{ lat: p.event.venue.lat, lon: p.event.venue.lon, title: `${i + 1}. ${p.event.venue.name}`, lines: [{ text: `${time(p.start)} — ${p.event.title}`, href: `/events/${p.event.id}` }] }] : []);
  const routeUrl = points.length === items.length && points.length > 1 ? `https://yandex.ru/maps/?${new URLSearchParams({ rtext: points.map((p) => `${p.lat},${p.lon}`).join("~"), rtt: input.transport === "car" ? "auto" : input.transport === "walk" ? "pd" : "mt" })}` : null;
  return <main className="mx-auto max-w-6xl px-4 pt-7 pb-16">
    <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-900"><ArrowLeft className="size-4" aria-hidden />{t("allAfisha")}</Link>
    <div className="mt-6 max-w-2xl"><p className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-[var(--brand)]"><Route className="size-4" aria-hidden />{t("planNav")}</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("planTitle")}</h1><p className="mt-4 text-stone-600">{t("planSubtitle")}</p></div>
    <form action="/plan" method="get" className="mt-8 rounded-3xl bg-white p-5 ring-1 ring-black/5 sm:p-7">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm font-medium">{t("planDate")}<input className={field} type="date" name="date" required min={localDay(0)} defaultValue={input.date} /></label>
        <label className="text-sm font-medium">{t("labelCity")}<select className={field} name="city" defaultValue={input.city}>{cityOptions.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="text-sm font-medium">{t("planPeople")}<input className={field} type="number" name="persons" required min={1} max={20} defaultValue={input.persons} /></label>
        <label className="text-sm font-medium">{t("planBudget")}<input className={field} type="number" name="budget" min={0} max={1_000_000} placeholder={t("planNoBudget")} defaultValue={input.budget ?? ""} /></label>
        <label className="text-sm font-medium">{t("planAge")}<input className={field} type="number" name="age" min={0} max={18} placeholder={t("planAnyAge")} defaultValue={input.age ?? ""} /></label>
        <label className="text-sm font-medium">{t("planCount")}<select className={field} name="count" defaultValue={input.count}>{[2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm font-medium">{t("planFrom")}<input className={field} type="time" name="from" required defaultValue={input.from} /></label><label className="text-sm font-medium">{t("planTo")}<input className={field} type="time" name="to" required defaultValue={input.to} /></label></div>
        <label className="text-sm font-medium">{t("planTransport")}<select className={field} name="transport" defaultValue={input.transport}><option value="transit">{t("planTransit")}</option><option value="car">{t("planCar")}</option><option value="walk">{t("planWalk")}</option></select></label>
        <label className="text-sm font-medium">{t("planTravelLimit")}<input className={field} type="number" name="maxTravelMin" required min={0} max={240} defaultValue={input.maxTravelMin} /></label>
      </div>
      <button className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-6 py-3 font-medium text-white hover:brightness-110">{t("planBuild")}<ArrowRight className="size-4" aria-hidden /></button>
    </form>
    {!parsed.success && <p role="alert" className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-900">{t("planInvalid")}</p>}
    {result && <section id="plan" className="scroll-mt-20 pt-10">
      {result.ok ? <div className="mb-7 flex flex-wrap items-end justify-between gap-5"><div><h2 className="text-2xl font-semibold">{t("planYourRoute")}</h2><p className="mt-2 inline-flex items-center gap-2 text-sm text-stone-500"><Users className="size-4" aria-hidden />{input.persons} · {input.city} · {t("planTravelTotal", { n: result.travelMin })}</p></div><div className="rounded-2xl bg-white px-5 py-3 ring-1 ring-black/5"><p className="text-xs text-stone-500">{t("planKnownCost")}</p><p className="mt-1 text-2xl font-semibold">{money(result.totalCost)}{result.unknownPrice && " + ?"}</p></div></div>
        : <div className="mb-6 rounded-2xl bg-amber-50 p-5 text-amber-950"><h2 className="font-semibold">{t("planIncomplete")}</h2><ul className="mt-3 space-y-2 text-sm">{result.violations.map((v, i) => <li key={i}>{v.message}. {t("planTry")}: {v.fix}.</li>)}</ul><Link href={`/plan?${planParams(input, { keep: [], exclude: [] })}`} className="mt-4 inline-block text-sm underline">{t("planResetSelection")}</Link></div>}
      {items.length > 0 && <div className="grid gap-7 lg:grid-cols-[3fr_2fr]">
        <ol className="space-y-4">{items.map((p, i) => {
          const excluded = [...new Set([...input.exclude, p.event.id])];
          const replace = excluded.length <= 100 ? `/plan?${planParams(input, { count: items.length, exclude: excluded, keep: items.filter((_, n) => n !== i).map((v) => v.event.id) })}#plan` : null;
          return <li key={p.event.id}>
            {i > 0 && <p className="mb-3 ml-5 flex items-center gap-2 text-xs text-stone-500"><Route className="size-3.5" aria-hidden />{p.travelMin ? t("planTravelLeg", { n: p.travelMin }) : t("planSameBuilding")}{p.travelUnknown && " · ?"}</p>}
            <article className="rounded-2xl bg-white p-5 ring-1 ring-black/5"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-stone-900 text-sm text-white">{i + 1}</span><p className="font-semibold tabular-nums">{time(p.start)}–{time(p.end)}</p></div><FavoriteButton eventId={p.event.id} compact lang={lang} /></div>
              <h3 className="mt-4 text-lg font-semibold"><Link href={`/events/${p.event.id}`} className="hover:text-[var(--brand)]">{p.event.title}</Link></h3>
              <p className="mt-2 flex items-start gap-1.5 text-sm text-stone-600"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{p.event.venue?.name}{p.event.venue?.address && ` · ${p.event.venue.address}`}</span></p>
              <p className="mt-3 text-sm font-medium">{p.cost == null ? t("priceUnknown") : p.cost === 0 ? t("free") : money(p.cost)}{p.event.ageLimit != null && <span className="ml-3 text-xs text-stone-500">{p.event.ageLimit}+</span>}</p>
              {p.flexible && <p className="mt-2 text-xs text-amber-800">{t("planFlexible")}</p>}
              {p.durationEstimated && <p className="mt-2 text-xs text-stone-500">{t("planDurationEstimate", { n: Math.round((p.end.getTime() - p.start.getTime()) / 60000) })}</p>}
              {result.ok && replace && <Link href={replace} scroll={false} className="mt-4 inline-flex items-center gap-1.5 text-sm text-[var(--brand)] hover:underline"><RefreshCw className="size-3.5" aria-hidden />{t("planReplace")}</Link>}
            </article>
          </li>;
        })}</ol>
        <aside className="space-y-4">{points.length > 0 && <VenueMap config={await mapConfig()} points={points} className="h-72" />}{routeUrl && <a href={routeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-[var(--brand)] hover:underline"><Route className="size-4" aria-hidden />{t("planMapRoute")}</a>}
          {result.ok && <div className="flex flex-wrap gap-2"><a href={`/plan/ics?${pinned}`} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-medium ring-1 ring-black/10"><CalendarPlus className="size-4" aria-hidden />{t("toCalendar")}</a><ShareButton title={`${t("planNav")} · ${input.city}`} label={t("share")} copiedLabel={t("copied")} url={`/plan?${pinned}#plan`} /></div>}
          {result.ok && result.note && <p className="rounded-xl bg-stone-100 p-3 text-sm text-stone-700">{result.note}</p>}
          {result.ok && result.unknownPrice && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("planUnknownCost")}</p>}
          {items.some((p) => p.travelUnknown) && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("planUnknownTravel")}</p>}
          <p className="text-xs leading-relaxed text-stone-500">{t("planEstimates")}</p>
        </aside>
      </div>}
      {!result.ok && items.length === 1 && <p className="mt-4 text-sm text-stone-600">{t("planSingle")}: {formatDateLongL(items[0].start.toISOString(), lang)}</p>}
    </section>}
  </main>;
}
