import "server-only";
import { htmlToText } from "./fetch";
import { jsonLdEvents } from "./jsonld";
import { parseFeed } from "./rss";

// Определение формата ленты по содержимому — для проверки на странице /docs/format.

export type DetectedFormat = "json" | "rss" | "rss_plain" | "jsonld" | "unknown";

/** Формат и строки событий; для обычного RSS без полей afisha: строк нет — только число записей. */
export function detectRows(text: string, url = ""): { format: DetectedFormat; rows: Record<string, unknown>[]; items: number; error?: string } {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    let data: unknown;
    try {
      data = JSON.parse(t);
    } catch (e) {
      return { format: "unknown", rows: [], items: 0, error: `JSON с ошибкой: ${e instanceof Error ? e.message : e}` };
    }
    const d = data as { events?: unknown; items?: unknown };
    const list = Array.isArray(data) ? data : Array.isArray(d.events) ? d.events : Array.isArray(d.items) ? d.items : null;
    if (!list) return { format: "unknown", rows: [], items: 0, error: "JSON: ожидается массив событий или объект { events: [...] }" };
    const rows = list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
    return { format: "json", rows, items: rows.length };
  }
  if (/<(rss|feed)[\s>]/i.test(t)) {
    const items = parseFeed(t);
    const structured = items.filter((i) => Object.keys(i.fields).length > 0);
    if (!structured.length) return { format: "rss_plain", rows: [], items: items.length };
    return {
      format: "rss",
      items: items.length,
      rows: structured.map((i) => ({ ...i.fields, title: i.fields.title ?? i.title, description: i.fields.description ?? htmlToText(i.description, 3000), sourceUrl: i.fields.sourceUrl ?? i.link, externalId: i.fields.externalId ?? i.guid })),
    };
  }
  if (/<html[\s>]/i.test(t) || /application\/ld\+json/i.test(t)) {
    const rows = jsonLdEvents(t, url);
    return { format: rows.length ? "jsonld" : "unknown", rows, items: rows.length, error: rows.length ? undefined : "на странице нет разметки schema.org Event" };
  }
  return { format: "unknown", rows: [], items: 0, error: "не похоже ни на JSON, ни на RSS, ни на страницу с разметкой schema.org" };
}
