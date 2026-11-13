import Link from "next/link";

// Отчёт об импорте по строкам: что добавлено, обновлено, пропущено и почему отклонено.

type Row = { row: number; result: "created" | "updated" | "unchanged" | "rejected"; reason?: string; eventId?: string; title?: string };

const RESULT: Record<Row["result"], [string, string]> = {
  created: ["добавлено", "text-emerald-700"],
  updated: ["обновлено", "text-sky-700"],
  unchanged: ["без изменений", "text-stone-500"],
  rejected: ["отклонено", "text-red-600"],
};

/** links: false — без ссылок на карточки (кабинет организатора: админские карточки ему закрыты). */
export function ImportReportTable({ rows, links = true }: { rows: Row[]; links?: boolean }) {
  // Отклонённые — первыми: их нужно исправить
  const sorted = [...rows].sort((a, b) => Number(b.result === "rejected") - Number(a.result === "rejected") || a.row - b.row);
  return (
    <div className="overflow-x-auto rounded-2xl ring-1 ring-black/5">
      <table className="w-full text-left text-sm">
        <thead className="bg-stone-100 text-xs text-stone-500">
          <tr>
            <th className="px-3 py-2 font-medium">Строка</th>
            <th className="px-3 py-2 font-medium">Итог</th>
            <th className="px-3 py-2 font-medium">Событие</th>
            <th className="px-3 py-2 font-medium">Причина / пометка</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5">
          {sorted.map((r) => (
            <tr key={r.row}>
              <td className="px-3 py-2 tabular-nums">{r.row}</td>
              <td className={`px-3 py-2 whitespace-nowrap ${RESULT[r.result][1]}`}>{RESULT[r.result][0]}</td>
              <td className="px-3 py-2">
                {r.eventId && links ? (
                  <Link href={`/admin/events/${r.eventId}`} className="hover:underline">
                    {r.title ?? "событие"}
                  </Link>
                ) : (
                  (r.title ?? "—")
                )}
              </td>
              <td className="px-3 py-2 text-stone-600">{r.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
