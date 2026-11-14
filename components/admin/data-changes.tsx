import Link from "next/link";
import { decideDataChange } from "@/app/admin/data-changes-actions";
import { CHANGE_LABELS } from "@/lib/server/data-changes";
import { db } from "@/lib/server/db";
import { parseUrl } from "@/lib/server/normalize";
import { Section } from "./blocks";
import { ActionButton } from "./ui";

export async function DataChanges() {
  const changes = await db.dataChange.findMany({ where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 100 });
  const eventIds = changes.filter((c) => c.entity === "event").map((c) => c.entityId);
  const venueIds = changes.filter((c) => c.entity === "venue").map((c) => c.entityId);
  const [events, venues, cats] = await Promise.all([
    db.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, title: true } }),
    db.venue.findMany({ select: { id: true, name: true, city: true } }),
    db.category.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map([...events.map((e) => [e.id, e.title] as const), ...venues.map((v) => [v.id, `${v.name}, ${v.city}`] as const)]);
  const foreign = new Map([...venues.map((v) => [v.id, `${v.name}, ${v.city}`] as const), ...cats.map((c) => [c.id, c.name] as const)]);
  const show = (field: string, value: unknown): string => {
    if (value == null) return "Не указано";
    if (typeof value === "boolean") return value ? "Да" : "Нет";
    if (typeof value === "string" && ["startsAt", "endsAt"].includes(field)) return new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg" });
    if (["categoryId", "venueId"].includes(field)) return foreign.get(String(value)) ?? String(value);
    if (field === "status") return ({ SCHEDULED: "Запланировано", RESCHEDULED: "Перенесено", CANCELLED: "Отменено", SOLD_OUT: "Билетов нет", PAST: "Прошло" } as Record<string, string>)[String(value)] ?? String(value);
    return Array.isArray(value) ? value.join(", ") : String(value);
  };
  return <Section title={`Изменения источников — ${changes.length}`} desc="Опубликованные карточки и защищённые адреса сохраняются до вашего решения. Сверьте новые сведения с источником, затем примите или отклоните изменение.">
    {changes.length ? <ul className="divide-y divide-black/10">{changes.map((c) => {
      const before = c.before as Record<string, unknown>, after = c.after as Record<string, unknown>, url = c.url ? parseUrl(c.url) : null;
      const exists = c.entity === "event" ? eventIds.includes(c.entityId) && events.some((e) => e.id === c.entityId) : venueIds.includes(c.entityId) && venues.some((v) => v.id === c.entityId);
      return <li key={c.id} className="space-y-3 py-5">
        <Link href={c.entity === "event" ? `/admin/events/${c.entityId}` : "/admin/venues"} className="font-medium hover:underline">{names.get(c.entityId) ?? "Карточка удалена"}</Link>
        <p className="text-xs text-stone-500">{c.source} · {c.createdAt.toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg" })}{url && <> · <a href={url} target="_blank" rel="noreferrer noopener" className="break-all underline">Открыть источник</a></>}</p>
        <div className="overflow-x-auto"><table className="w-full table-fixed text-left text-sm"><thead><tr className="text-stone-500"><th className="w-1/5 p-2">Поле</th><th className="p-2">Было</th><th className="p-2">Стало</th></tr></thead><tbody>{Object.keys(after).map((k) => <tr key={k} className="border-t border-black/5 align-top"><th className="break-words p-2 font-medium">{CHANGE_LABELS[k] ?? k}</th><td className="p-2"><p className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{show(k, before[k])}</p></td><td className="bg-amber-50 p-2"><p className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{show(k, after[k])}</p></td></tr>)}</tbody></table></div>
        <div className="flex flex-wrap gap-3">{exists && <ActionButton action={decideDataChange.bind(null, c.id, true)}>Принять изменение</ActionButton>}<ActionButton action={decideDataChange.bind(null, c.id, false)}>Отклонить</ActionButton></div>
      </li>;
    })}</ul> : <p className="text-sm text-stone-500">Изменений, ожидающих проверки, нет.</p>}
  </Section>;
}
