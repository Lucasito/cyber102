import "server-only";

// Загрузка страниц и лент для сборщиков: таймаут, предел размера, понятные ошибки.
// User-Agent — общий, без персональных данных; сайты учреждений видят, кто к ним ходит.

import { getSettings } from "../settings";
import { robotsAllow } from "./robots";

const UA = "AfishaRB/1.0 (+https://afisha.193-47-33-213.sslip.io/docs/format)";
const MAX_BYTES = 3 * 1024 * 1024;

export class FetchError extends Error {}

export type PageCache = Map<string, Promise<Awaited<ReturnType<typeof fetchText>>>>;
/** Повторный разбор в одном обходе использует уже загруженную страницу, включая неудачные попытки. */
export function cachedPage(pages: PageCache, url: string, options: Parameters<typeof fetchText>[1] = { accept: "text/html" }) {
  let page = pages.get(url);
  if (!page) { page = fetchText(url, options); pages.set(url, page); }
  return page;
}

/**
 * Текст по адресу (http/https). Ответ больше 3 МБ, не 2xx или дольше timeoutMs — ошибка.
 * robots — соблюдать robots.txt сайта (сборщик); проверка ленты по просьбе владельца сайта — без него.
 */
export async function fetchText(url: string, { timeoutMs = 20_000, accept = "*/*", robots = true } = {}): Promise<{ text: string; contentType: string; finalUrl: string }> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new FetchError("адрес не похож на ссылку");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new FetchError("поддерживаются только ссылки http(s)");
  // Соблюдение robots.txt включается в админке («Источники»)
  if (robots && (await getSettings("collect")).respectRobots && !(await robotsAllow(target, UA))) throw new FetchError("сайт закрыл эту страницу для роботов (robots.txt)");
  let res: Response;
  try {
    res = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": UA, Accept: accept } });
  } catch (e) {
    throw new FetchError(e instanceof Error && e.name === "TimeoutError" ? "сайт не ответил вовремя" : `сайт недоступен (${e instanceof Error ? e.message : e})`);
  }
  if (!res.ok) throw new FetchError(`сайт ответил кодом ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new FetchError("ответ больше 3 МБ");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new FetchError("ответ больше 3 МБ");
  const contentType = res.headers.get("content-type") ?? "";
  // Кодировка: из заголовка или из XML/HTML-объявления; по умолчанию UTF-8
  const head = new TextDecoder("latin1").decode(buf.slice(0, 1024));
  const charset = (contentType.match(/charset=([\w-]+)/i)?.[1] ?? head.match(/encoding=["']([\w-]+)["']/i)?.[1] ?? head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? "utf-8").toLowerCase();
  let text: string;
  try {
    text = new TextDecoder(charset === "windows-1251" || charset === "cp1251" ? "windows-1251" : charset).decode(buf);
  } catch {
    text = new TextDecoder("utf-8").decode(buf);
  }
  return { text, contentType, finalUrl: res.url || url };
}

/**
 * HTML → текст для разбора: без скриптов, стилей, меню; пробелы схлопнуты.
 * linksBase — сохранить ссылки как «текст (адрес)» с полными адресами (для разбора страницы афиши ИИ).
 */
export function htmlToText(html: string, max = 8000, linksBase?: string) {
  let src = html;
  if (linksBase) {
    src = src.replace(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      let abs = href;
      try {
        abs = new URL(href, linksBase).toString();
      } catch {
        // некорректная ссылка — оставляем как есть
      }
      return `${inner} (${abs}) `;
    });
  }
  return decodeEntities(
    src
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, max);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…" };

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
