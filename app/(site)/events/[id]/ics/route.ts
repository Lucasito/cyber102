import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

/** Файл .ics — добавить событие в календарь телефона или почты. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await db.event.findFirst({ where: { id, publication: "PUBLISHED" }, include: { venue: true } });
  if (!e) return new Response("Not found", { status: 404 });
  const url = `${process.env.PUBLIC_URL || new URL(request.url).origin}/events/${e.id}`;
  const end = e.endsAt ?? new Date(e.startsAt.getTime() + 2 * 3600_000);
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Afisha RB//RU",
    "BEGIN:VEVENT",
    `UID:${e.id}@afisha-rb`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title)}`,
    e.venue ? `LOCATION:${esc([e.venue.name, e.venue.address, e.venue.city].filter(Boolean).join(", "))}` : "",
    `URL:${url}`,
    `DESCRIPTION:${esc(url)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
  return new Response(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="event-${e.id}.ics"` },
  });
}
