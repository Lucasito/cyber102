import type { Metadata } from "next";
import { FavoritesPanel } from "@/components/favorites-panel";
import { getLang } from "@/lib/server/lang";
import { botLinks } from "@/lib/server/bot-links";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Избранное", robots: { index: false, follow: true } };

export default async function FavoritesPage() {
  const [lang, bots] = await Promise.all([getLang(), botLinks()]);
  return <main className="mx-auto max-w-6xl px-4 py-10"><h1 className="text-3xl font-semibold tracking-tight">{tr(lang, "favorites")}</h1><p className="mt-3 mb-8 max-w-2xl text-stone-600">{tr(lang, "favoritesHint")}</p><FavoritesPanel lang={lang} bots={bots} /></main>;
}
