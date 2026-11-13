"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

/** «Поделиться»: системное меню на телефоне, копирование ссылки на компьютере. */
export function ShareButton({ title, label, copiedLabel }: { title: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" onClick={share} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-medium ring-1 ring-black/10 hover:ring-black/30">
      {copied ? <Check className="size-4 text-[var(--brand)]" /> : <Share2 className="size-4" />}
      {copied ? copiedLabel : label}
    </button>
  );
}
