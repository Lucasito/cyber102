"use client";

import { Check, Copy, LoaderCircle } from "lucide-react";
import { useState } from "react";

/** Блок кода с кнопкой «Копировать». */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // буфер обмена недоступен (старый браузер, нет разрешения) — код можно выделить вручную
          }
        }}
        className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs text-stone-100 hover:bg-white/20"
        aria-label={`Копировать ${label ?? "код"}`}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Скопировано" : "Копировать"}
      </button>
      <pre className="max-h-[28rem] overflow-auto rounded-2xl bg-stone-900 p-4 pt-12 text-[13px] leading-relaxed text-stone-100">{code}</pre>
    </div>
  );
}

type Row = { row: number; ok: boolean; title?: string; startsAt?: string; city?: string; venue?: string; issues: string[]; error?: string };
type Result = { format: string; hint: string; items: number; events: number; ok: number; withIssues: number; rows: Row[] } | { code: string; message: string };

const FORMAT_NAMES: Record<string, string> = { json: "JSON", rss: "RSS с полями afisha:", rss_plain: "обычный RSS", jsonld: "страница со schema.org", unknown: "не распознан" };

/** Проверка ленты: адрес или вставленный текст → как каждая запись пройдёт в афишу. Ничего не сохраняет. */
export function FeedChecker() {
  const [mode, setMode] = useState<"url" | "content">("url");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);

  async function check() {
    if (!value.trim()) return;
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch("/api/v1/format/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "url" ? { url: value.trim() } : { content: value }),
      });
      setRes(await r.json());
    } catch {
      setRes({ code: "network", message: "Не удалось связаться с сервером — попробуйте ещё раз" });
    } finally {
      setBusy(false);
    }
  }

  const tab = (m: "url" | "content", label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`rounded-full px-3 py-1.5 text-sm ${mode === m ? "bg-stone-900 text-white" : "bg-white ring-1 ring-black/10"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-black/10">
      <div className="flex gap-2">
        {tab("url", "По адресу")}
        {tab("content", "Вставить текст")}
      </div>
      {mode === "url" ? (
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          type="url"
          placeholder="https://ваш-сайт.ru/afisha/feed.json"
          aria-label="Адрес ленты"
          className="w-full rounded-xl border border-black/15 px-3 py-2 text-sm"
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={8}
          placeholder="Вставьте JSON или RSS"
          aria-label="Текст ленты"
          className="w-full rounded-xl border border-black/15 px-3 py-2 font-mono text-xs"
        />
      )}
      <button
        type="button"
        onClick={check}
        disabled={busy || !value.trim()}
        className="inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy && <LoaderCircle className="size-4 animate-spin" />} Проверить
      </button>

      {res && "message" in res && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{res.message}</p>}
      {res && "format" in res && (
        <div className="space-y-2 text-sm" aria-live="polite">
          <p>
            Формат: <b>{FORMAT_NAMES[res.format] ?? res.format}</b>. {res.hint}
          </p>
          {res.events > 0 && (
            <p>
              Событий: <b>{res.events}</b>, пройдут в афишу: <b className="text-emerald-700">{res.ok}</b>
              {res.withIssues > 0 && <> (из них с замечаниями — {res.withIssues}, их посмотрит модератор)</>}, не пройдут:{" "}
              <b className="text-red-700">{res.events - res.ok}</b>.
            </p>
          )}
          {res.rows.length > 0 && (
            <ul className="max-h-96 divide-y divide-black/5 overflow-auto rounded-xl border border-black/10">
              {res.rows.map((r) => (
                <li key={r.row} className="px-3 py-2">
                  <span className={r.ok ? "text-emerald-700" : "text-red-700"}>{r.ok ? "✓" : "✗"}</span> {r.row}. <b>{r.title ?? "без названия"}</b>
                  {r.ok && r.startsAt && (
                    <span className="text-stone-500">
                      {" "}
                      · {new Date(r.startsAt).toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} ·{" "}
                      {r.venue}, {r.city}
                    </span>
                  )}
                  {(r.error || r.issues.length > 0) && <div className={`text-xs ${r.ok ? "text-amber-700" : "text-red-700"}`}>{r.error ?? r.issues.join("; ")}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
