import { Bell } from "lucide-react";
import { tr, type Lang } from "@/lib/i18n";

export type PublicBotLink = { platform: "max" | "telegram"; label: string; url: string };

export function EventWatchLinks({ eventId, bots, lang }: { eventId: string; bots: PublicBotLink[]; lang: Lang }) {
  if (!bots.length) return null;
  return <details className="text-sm">
    <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1.5 text-[var(--brand)] hover:bg-black/5"><Bell className="size-4" aria-hidden />{tr(lang, "watchChanges")}</summary>
    <p className="mt-2 max-w-md text-xs text-stone-600">{tr(lang, "watchHint")}</p>
    <div className="mt-2 flex flex-wrap gap-2">{bots.map((bot) => {
      const url = new URL(bot.url); url.searchParams.set("start", `watch_${eventId}`);
      return <a key={bot.platform} href={url.toString()} target="_blank" rel="noopener noreferrer" className="rounded-full bg-stone-900 px-3 py-1.5 text-xs font-medium text-white">{bot.label}</a>;
    })}</div>
  </details>;
}
