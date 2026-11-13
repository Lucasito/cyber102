"use client";

import { LoaderCircle, Upload } from "lucide-react";
import { useActionState } from "react";
import { importLocalization } from "@/app/admin/actions";

/** Загрузка CSV башкирской локализации с отчётом проверки. */
export function LocalizationUpload() {
  const [state, action, pending] = useActionState(importLocalization, null);
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="block min-w-0 flex-1">
          <span className="text-sm font-medium text-stone-700">Файл CSV</span>
          <input
            name="file"
            type="file"
            required
            accept=".csv,text/csv"
            className="mt-1 block w-full rounded-xl bg-stone-100 px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-1 file:text-sm"
          />
        </label>
        <button disabled={pending} className="inline-flex items-center gap-2 rounded-full bg-stone-900 px-5 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />} Проверить и загрузить
        </button>
      </form>
      {state && (
        <div className="space-y-2 text-sm" role="status">
          <p className={state.ok ? "font-medium text-emerald-700" : "font-medium text-red-700"}>{state.message}</p>
          {!!state.errors?.length && (
            <ul className="list-disc space-y-0.5 pl-5 text-red-700">
              {state.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {!!state.warnings?.length && (
            <ul className="list-disc space-y-0.5 pl-5 text-amber-700">
              {state.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
