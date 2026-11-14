const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escape = (text: string) => text.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r\n|\r|\n/g, "\\n");

/** Строки календаря — до 75 октетов UTF-8, включая переносы длинных кириллических названий. */
function fold(line: string) {
  const parts: string[] = [];
  let part = "", bytes = 0;
  for (const c of line) {
    const size = new TextEncoder().encode(c).length;
    if (bytes + size > 75) { parts.push(part); part = " "; bytes = 1; }
    part += c; bytes += size;
  }
  parts.push(part);
  return parts.join("\r\n");
}
export function calendar(items: { id: string; title: string; start: Date; end: Date; location: string; url: string; description?: string; cancelled?: boolean }[]) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Afisha RB//RU", "CALSCALE:GREGORIAN"];
  for (const item of items) lines.push("BEGIN:VEVENT", `UID:${escape(item.id)}@afisha-rb`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(item.start)}`, `DTEND:${stamp(item.end)}`,
    `SUMMARY:${escape(item.title)}`, `LOCATION:${escape(item.location)}`, `URL:${escape(item.url)}`, `DESCRIPTION:${escape(item.description ?? item.url)}`, ...(item.cancelled ? ["STATUS:CANCELLED"] : []), "END:VEVENT");
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
