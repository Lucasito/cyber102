"use client";

import { LoaderCircle } from "lucide-react";
import { useState, useTransition } from "react";
import type { PreviewResult } from "@/lib/server/collect";

type Action = (id: string) => Promise<{ ok: true; result: PreviewResult } | { ok: false; message: string }>;

const fmt = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

/** «Проверить без записи»: что прочитано из источника и как каждая запись пройдёт импорт. */
export function SourcePreview({ id, action, ai }: { id: string; action: Action; ai: boolean }) {
  const [state, setState] = useState<Awaited<ReturnType<Action>> | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setState(await action(id)))}
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium ring-1 ring-black/10 hover:ring-black/30 disabled:opacity-50"
        >
          {pending && <LoaderCircle className="size-4 animate-spin" />} Проверить без записи
        </button>
        <span className="text-xs text-stone-500">{ai ? "Разберёт до 3 новых записей ленты — это расход токенов ИИ." : "Ничего не сохраняет."}</span>
      </div>
      {state && !state.ok && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">Не получилось: {state.message}</p>}
      {state?.ok && (
        <div className="space-y-2 text-sm">
          <p className="text-stone-600">
            Записей в источнике: <b>{state.result.feedItems}</b> · событий прочитано: <b>{state.result.rows.length}</b> · пройдут импорт:{" "}
            <b>{state.result.rows.filter((r) => r.ok).length}</b>
            {state.result.tokens > 0 && ` · ИИ: ${state.result.tokens} ток. (~${state.result.costRub.toFixed(2)} ₽)`}
          </p>
          {state.result.message && <p className="text-amber-700">{state.result.message}</p>}
          {state.result.rows.length > 0 && (
            <ul className="divide-y divide-black/5 rounded-xl border border-black/10">
              {state.result.rows.map((r) => (
                <li key={r.row} className="px-3 py-2">
                  <span className={r.ok ? "text-emerald-700" : "text-red-700"}>{r.ok ? "✓" : "✗"}</span> <b>{r.title ?? "без названия"}</b>
                  {r.ok && (
                    <span className="text-stone-500">
                      {" "}
                      · {fmt(r.startsAt)} · {r.venue}, {r.city}
                    </span>
                  )}
                  {(r.error || r.issues.length > 0) && <div className={`text-xs ${r.ok ? "text-amber-700" : "text-red-700"}`}>{r.error ?? r.issues.join("; ")}</div>}
                </li>
              ))}
            </ul>
          )}
          {state.result.skipped.length > 0 && (
            <div>
              <p className="text-stone-600">Пропущены записи ленты:</p>
              <ul className="list-disc pl-5 text-xs text-stone-500">
                {state.result.skipped.map((s) => (
                  <li key={s.guid}>
                    {s.title.slice(0, 100)} — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
