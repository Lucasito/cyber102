"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart, RefreshCw } from "lucide-react";
import type { CardEvent } from "@/lib/format";
import { formatDateLongL, formatPriceL, statusLabel, tr, type Lang } from "@/lib/i18n";
import { useFavorites } from "@/lib/use-favorites";
import { EventCard } from "./event-card";
import { FavoriteButton } from "./favorite-button";
import { EventWatchLinks, type PublicBotLink } from "./event-watch-links";

type SavedEvent = CardEvent & { venue: { name: string; city: string; address: string | null } | null };
type Loaded = { key: string; items: SavedEvent[]; missing: string[]; error?: boolean };

export function FavoritesPanel({ lang, bots }: { lang: Lang; bots: PublicBotLink[] }) {
  const { ids, persistent } = useFavorites();
  const [revision, setRevision] = useState(0);
  const [compare, setCompare] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const query = ids.join(","), key = `${revision}:${query}`;
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    fetch(`/api/v1/events/batch?ids=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error("load_failed"); return r.json(); })
      .then((data) => setLoaded({ key, items: data.items, missing: data.missing }))
      .catch(() => { if (!controller.signal.aborted) setLoaded({ key, items: [], missing: [], error: true }); });
    return () => controller.abort();
  }, [key, query]);
  if (!ids.length) return <div className="rounded-3xl bg-white px-6 py-14 text-center ring-1 ring-black/5"><Heart className="mx-auto mb-4 size-8 text-stone-400" aria-hidden /><h2 className="text-xl font-semibold">{tr(lang, "favoritesEmpty")}</h2><p className="mt-2 text-sm text-stone-600">{tr(lang, "favoritesEmptyHint")}</p><Link href="/" className="mt-5 inline-block rounded-full bg-stone-900 px-5 py-2.5 text-sm text-white">{tr(lang, "allAfisha")}</Link></div>;
  const loading = loaded?.key !== key;
  const items = !loading && loaded ? [...loaded.items].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) : [];
  return <div className="space-y-5">
    {!persistent && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{tr(lang, "favoritesMemoryOnly")}</p>}
    <div className="flex flex-wrap items-center gap-3"><button type="button" aria-pressed={compare} onClick={() => setCompare(!compare)} className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-black/10">{tr(lang, compare ? "viewList" : "compareEvents")}</button><button type="button" disabled={loading} onClick={() => setRevision((r) => r + 1)} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm ring-1 ring-black/10 disabled:opacity-50"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden />{tr(lang, "refreshEvents")}</button><span className="text-sm text-stone-500">{ids.length}/100</span></div>
    {loading ? <p role="status" className="py-8 text-stone-600">{tr(lang, "loadingEvents")}</p> : loaded?.error ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">{tr(lang, "favoritesLoadError")}</p> : <>
      {compare ? <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-black/5"><table className="w-full min-w-[640px] text-left text-sm"><caption className="sr-only">{tr(lang, "compareEvents")}</caption><thead className="border-b border-black/5 text-stone-500"><tr>{(["eventColumn", "dateColumn", "placeColumn", "priceColumn"] as const).map((k) => <th key={k} className="p-4 font-medium">{tr(lang, k)}</th>)}<th className="p-4"><span className="sr-only">{tr(lang, "favorites")}</span></th></tr></thead><tbody>{items.map((e) => <tr key={e.id} className="border-b border-black/5 align-top"><th className="max-w-64 p-4 font-medium"><Link href={`/events/${e.id}`} className="hover:underline">{e.title}</Link>{statusLabel(e.status, lang) && <p className="mt-1 text-xs text-amber-800">{statusLabel(e.status, lang)}</p>}</th><td className="p-4">{formatDateLongL(e.startsAt, lang)}{e.ageLimit != null && <p className="mt-1 text-xs text-stone-500">{e.ageLimit}+</p>}</td><td className="max-w-64 p-4">{e.venue?.city}<p>{e.venue?.name}</p><p className="mt-1 text-xs text-stone-500">{e.venue?.address}</p></td><td className="whitespace-nowrap p-4 font-medium">{formatPriceL(e, lang)}</td><td className="p-4"><FavoriteButton eventId={e.id} compact lang={lang} /></td></tr>)}</tbody></table></div>
        : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map((e) => <div key={e.id} className="flex min-w-0 flex-col gap-2"><EventCard event={e} lang={lang} /><EventWatchLinks eventId={e.id} bots={bots} lang={lang} /></div>)}</div>}
      {loaded?.missing.map((id) => <div key={id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-100 p-4 text-sm"><span>{tr(lang, "favoritesMissing")}</span><FavoriteButton eventId={id} lang={lang} /></div>)}
    </>}
  </div>;
}
