"use client";

import Link from "next/link";
import { Heart, Route } from "lucide-react";
import { tr, type Lang } from "@/lib/i18n";
import { useFavorites } from "@/lib/use-favorites";

export function SiteToolsNav({ lang }: { lang: Lang }) {
  const { ids } = useFavorites();
  return <nav className="flex shrink-0 items-center gap-1" aria-label={tr(lang, "myPlans")}>
    <Link href="/plan" title={tr(lang, "planNav")} className="inline-flex items-center gap-1.5 rounded-full p-2 hover:bg-black/5"><Route className="size-4" aria-hidden /><span className="max-lg:sr-only">{tr(lang, "planNav")}</span></Link>
    <Link href="/favorites" title={tr(lang, "favorites")} className="relative inline-flex items-center gap-1.5 rounded-full p-2 hover:bg-black/5"><Heart className="size-4" aria-hidden /><span className="max-lg:sr-only">{tr(lang, "favorites")}</span>{ids.length > 0 && <span className="absolute -top-0.5 -right-1 rounded-full bg-[var(--brand)] px-1 text-[10px] leading-4 text-white lg:static">{ids.length}</span>}</Link>
  </nav>;
}
