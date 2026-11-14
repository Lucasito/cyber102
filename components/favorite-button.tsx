"use client";

import { Heart } from "lucide-react";
import { useState } from "react";
import { tr, type Lang } from "@/lib/i18n";
import { toggleFavorite, useFavorites } from "@/lib/use-favorites";

export function FavoriteButton({ eventId, lang = "ru", compact = false }: { eventId: string; lang?: Lang; compact?: boolean }) {
  const { ids, persistent } = useFavorites();
  const active = ids.includes(eventId);
  const [error, setError] = useState("");
  const label = tr(lang, active ? "favoriteRemove" : "favoriteAdd");
  return <span className="inline-flex flex-col items-start gap-1">
    <button type="button" aria-pressed={active} aria-label={label} title={label}
      onClick={() => { try { toggleFavorite(eventId); setError(""); } catch { setError(tr(lang, "favoritesLimit")); } }}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white font-medium ring-1 ring-black/10 transition hover:ring-black/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${compact ? "size-9" : "px-5 py-3"} ${active ? "text-[var(--brand)]" : "text-stone-700"}`}>
      <Heart className={`size-4 ${active ? "fill-current" : ""}`} aria-hidden />{!compact && label}
    </button>
    {error && <span role="status" className="max-w-56 rounded bg-amber-50 p-1 text-xs text-amber-900">{error}</span>}
    {!persistent && !compact && <span role="status" className="max-w-72 text-xs text-amber-900">{tr(lang, "favoritesMemoryOnly")}</span>}
  </span>;
}
