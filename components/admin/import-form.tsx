"use client";

import { LoaderCircle, TriangleAlert, Upload } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { importFile } from "@/app/admin/events-actions";
import { organizerImportFile } from "@/app/admin/organizer-actions";
import { ImportReportTable } from "./import-report";

/** organizer — кабинет организатора: всё в модерацию, без кода источника и ссылок на админские карточки. */
export function ImportForm({ organizer = false }: { organizer?: boolean }) {
  const [state, action, pending] = useActionState(
    organizer ? organizerImportFile : importFile,
    null,
  );
  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4">
        <div
          className={`grid gap-4 ${organizer ? "" : "sm:grid-cols-[2fr_1fr]"}`}
        >
          <label className="block">
            <span className="text-sm font-medium text-stone-700">
              Файл CSV или JSON
            </span>
            <input
              name="file"
              type="file"
              required
              accept=".csv,.json,text/csv,application/json"
              className="mt-1 block w-full rounded-xl bg-stone-100 px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-1 file:text-sm"
            />
          </label>
          {!organizer && (
            <label className="block">
              <span className="text-sm font-medium text-stone-700">
                Код источника
              </span>
              <input
                name="source"
                placeholder="по имени файла"
                className="mt-1 w-full rounded-xl bg-stone-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--brand)]"
              />
              <span className="mt-1 block text-xs text-stone-500">
                Например, minkult — одинаковый для повторных загрузок
              </span>
            </label>
          )}
        </div>
        <button
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-full bg-stone-900 px-5 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}{" "}
          Загрузить
        </button>
      </form>
      {state && !state.ok && (
        <p
          className="flex items-start gap-1.5 text-sm text-red-600"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      )}
      {state?.ok && state.report && (
        <div className="space-y-3" role="status">
          <p className="text-sm font-medium">{state.message}</p>
          <ImportReportTable rows={state.report.rows} links={!organizer} />
          {organizer ? (
            <Link
              href="/admin/my"
              className="text-sm text-stone-600 hover:underline"
            >
              Мои события →
            </Link>
          ) : (
            <Link
              href={`/admin/import/${state.report.importId}`}
              className="text-sm text-stone-600 hover:underline"
            >
              Отчёт по этой загрузке →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
