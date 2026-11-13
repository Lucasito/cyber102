import "server-only";
import { decodeEntities } from "./fetch";

// Разбор RSS 2.0 (и Atom) без зависимостей: ленты учреждений простые, нужен лишь список записей.
// Элементы универсального формата — с префиксом afisha: (пространство имён urn:afisha-rb:1),
// они попадают в fields без префикса: afisha:dateStart → fields.dateStart. Описание формата — /docs/format.

export type FeedItem = { guid: string; title: string; link: string; description: string; pubDate: string | null; fields: Record<string, string> };

const unwrap = (s: string) => decodeEntities(s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim());

/** Значение первого тега name внутри block (или null). */
function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unwrap(m[1]) : null;
}

export function parseFeed(xml: string): FeedItem[] {
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) throw new Error("это не RSS/Atom: нет корневого элемента rss или feed");
  const atom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = [...xml.matchAll(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  return blocks.map((b) => {
    const link = atom ? (b.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? "") : (tag(b, "link") ?? "");
    const fields: Record<string, string> = {};
    for (const m of b.matchAll(/<afisha:(\w+)(?:\s[^>]*)?>([\s\S]*?)<\/afisha:\1>/gi)) fields[m[1]] = unwrap(m[2]);
    const title = tag(b, "title") ?? "";
    const guid = tag(b, atom ? "id" : "guid") || link || title;
    return {
      guid: guid.slice(0, 500),
      title,
      link: link.trim(),
      description: tag(b, atom ? "summary" : "description") ?? tag(b, "content") ?? tag(b, "content:encoded") ?? "",
      pubDate: tag(b, atom ? "updated" : "pubDate"),
      fields,
    };
  });
}
