import type { EventStatus, Publication } from "@/generated/prisma/client";

// Пометки события в админке: публикация, статус, спорная карточка.

const STATUS: Record<EventStatus, [string, string]> = {
  SCHEDULED: ["", ""],
  RESCHEDULED: ["перенесено", "bg-amber-100 text-amber-900"],
  CANCELLED: ["отменено", "bg-red-100 text-red-800"],
  SOLD_OUT: ["билетов нет", "bg-stone-200 text-stone-700"],
  PAST: ["прошло", "bg-stone-200 text-stone-600"],
};

export function EventBadges({ status, publication, needsReview }: { status: EventStatus; publication: Publication; needsReview: boolean }) {
  const [label, cls] = STATUS[status];
  return (
    <span className="inline-flex flex-wrap gap-1">
      {publication === "DRAFT" ? (
        <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700">черновик</span>
      ) : (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">на сайте</span>
      )}
      {label && <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>}
      {needsReview && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">спорная</span>}
    </span>
  );
}

export const fmtDateTime = (d: Date | null | undefined) => (d ? d.toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

/** Значение для <input type="datetime-local"> в местном времени республики. */
export const toLocalInput = (d: Date | null | undefined) => (d ? d.toLocaleString("sv-SE", { timeZone: "Asia/Yekaterinburg" }).slice(0, 16).replace(" ", "T") : "");
