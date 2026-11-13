"use client";

import { LoaderCircle, LocateFixed } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/** «Рядом со мной»: геолокация браузера → ?near=lat,lon&sort=distance. Повторное нажатие снимает фильтр. */
export function NearMeButton({ active, label, errors }: { active: boolean; label: string; errors: { unsupported: string; denied: string } }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function go(params: URLSearchParams) {
    params.delete("limit");
    router.push(`/?${params.toString()}#events`, { scroll: false });
  }

  function toggle() {
    const params = new URLSearchParams(sp.toString());
    if (active) {
      params.delete("near");
      params.delete("radius");
      if (params.get("sort") === "distance") params.delete("sort");
      return go(params);
    }
    if (!navigator.geolocation) return setError(errors.unsupported);
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        params.set("near", `${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`);
        params.set("sort", "distance");
        params.delete("city");
        go(params);
      },
      () => {
        setBusy(false);
        setError(errors.denied);
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={active}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition ${active ? "bg-stone-900 text-white" : "bg-white text-stone-700 ring-1 ring-black/5 hover:ring-black/20"}`}
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <LocateFixed className="size-4" />} {label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
