import Link from "next/link";
import { EVENT_FIELD_LABELS } from "@/lib/server/audit";
import { fmtDateTime } from "./event-badges";

// Записи журнала изменений: кто, когда, что и какие поля (было → стало).

type Item = { id: string; userLogin: string | null; action: string; entity: string; entityId: string | null; summary: string; diff: unknown; createdAt: Date };

const show = (v: unknown) => {
  if (v == null || v === "") return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(new Date(v));
  if (typeof v === "boolean") return v ? "да" : "нет";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};

export function AuditList({ items, links = false }: { items: Item[]; links?: boolean }) {
  if (!items.length) return <p className="text-sm text-stone-500">Записей нет.</p>;
  return (
    <ul className="space-y-3 text-sm">
      {items.map((a) => {
        const diff = a.diff && typeof a.diff === "object" ? Object.entries(a.diff as Record<string, [unknown, unknown]>) : [];
        return (
          <li key={a.id} className="rounded-xl bg-stone-50 px-3 py-2">
            <div className="flex flex-wrap gap-x-3 text-xs text-stone-500">
              <span className="tabular-nums">{fmtDateTime(a.createdAt)}</span>
              <span>{a.userLogin ?? "система"}</span>
            </div>
            <div className="mt-0.5">
              {links && a.entity === "event" && a.entityId ? (
                <Link href={`/admin/events/${a.entityId}`} className="hover:underline">
                  {a.summary}
                </Link>
              ) : links && a.entity === "import" && a.entityId ? (
                <Link href={`/admin/import/${a.entityId}`} className="hover:underline">
                  {a.summary}
                </Link>
              ) : (
                a.summary
              )}
            </div>
            {diff.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-stone-600">
                {diff.map(([field, [before, after]]) => (
                  <li key={field}>
                    {EVENT_FIELD_LABELS[field] ?? field}: <s className="text-stone-400">{show(before)}</s> → {show(after)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
