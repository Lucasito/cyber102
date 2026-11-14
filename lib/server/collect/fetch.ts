import "server-only";

// Загрузка страниц и лент для сборщиков: таймаут, предел размера, понятные ошибки.
// User-Agent — общий, без персональных данных; сайты учреждений видят, кто к ним ходит.

import { getSettings } from "../settings";
import { robotsAllow } from "./robots";

const UA = "AfishaRB/1.0 (+https://afisha.193-47-33-213.sslip.io/docs/format)";
const MAX_BYTES = 3 * 1024 * 1024;

export class FetchError extends Error {}

/**
 * Бережная нагрузка на чужие сайты: к одному сайту — не чаще одного запроса в HOST_INTERVAL_MS (очередь по
 * хосту, общая для всех сборщиков процесса). Сайт ответил 429/503 — не обращаемся к нему HOST_BACKOFF_MS.
 */
export const HOST_INTERVAL_MS = 3_000;
const HOST_BACKOFF_MS = 30 * 60_000;
const nextSlot = new Map<string, number>();
const backoffUntil = new Map<string, number>();
async function politeSlot(host: string) {
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return; // свой сервер (проверки) — без пауз
  const blocked = backoffUntil.get(host) ?? 0;
  if (blocked > Date.now()) throw new FetchError("сайт просил снизить частоту запросов — повторим позже");
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + HOST_INTERVAL_MS);
  if (at > now) await new Promise((ok) => setTimeout(ok, at - now));
}

export type PageCache = Map<string, Promise<Awaited<ReturnType<typeof fetchText>>>>;
/** Повторный разбор в одном обходе использует уже загруженную страницу, включая неудачные попытки. */
export function cachedPage(pages: PageCache, url: string, options: Parameters<typeof fetchText>[1] = { accept: "text/html" }) {
  let page = pages.get(url);
  if (!page) { page = fetchText(url, options); pages.set(url, page); }
  return page;
}

/**
 * Перенаправления с cookie, как в браузере: некоторые сайты (кинотеатры на Premierzal) сначала ставят cookie
 * выбранного города и перенаправляют на ту же страницу — без cookie это бесконечный цикл.
 * Cookie живут только в пределах одного запроса и никуда не сохраняются.
 */
async function fetchWithCookies(start: URL, timeoutMs: number, accept: string): Promise<Response> {
  const jar = new Map<string, string>();
  const signal = AbortSignal.timeout(timeoutMs);
  let target = start;
  for (let hop = 0; hop < 10; hop++) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(target, { redirect: "manual", signal, headers: { "User-Agent": UA, Accept: accept, ...(cookie ? { Cookie: cookie } : {}) } });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    const next = new URL(location, target);
    if (next.protocol !== "http:" && next.protocol !== "https:") throw new FetchError("перенаправление на неподдерживаемый адрес");
    target = next;
  }
  throw new FetchError("слишком много перенаправлений");
}

/**
 * Текст по адресу (http/https). Ответ больше 3 МБ, не 2xx или дольше timeoutMs — ошибка.
 * robots — соблюдать robots.txt сайта (сборщик); проверка ленты по просьбе владельца сайта — без него.
 */
export async function fetchText(url: string, { timeoutMs = 20_000, accept = "*/*", robots = true, cookies = false } = {}): Promise<{ text: string; contentType: string; finalUrl: string }> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new FetchError("адрес не похож на ссылку");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new FetchError("поддерживаются только ссылки http(s)");
  // Соблюдение robots.txt включается в админке («Источники»)
  if (robots && (await getSettings("collect")).respectRobots && !(await robotsAllow(target, UA))) throw new FetchError("сайт закрыл эту страницу для роботов (robots.txt)");
  await politeSlot(target.host);
  let res: Response;
  try {
    res = cookies ? await fetchWithCookies(target, timeoutMs, accept) : await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": UA, Accept: accept } });
  } catch (e) {
    throw new FetchError(e instanceof Error && e.name === "TimeoutError" ? "сайт не ответил вовремя" : `сайт недоступен (${e instanceof Error ? e.message : e})`);
  }
  if (res.status === 429 || res.status === 503) {
    // Сайт перегружен или просит реже: Retry-After в секундах, иначе — полчаса
    const after = Number(res.headers.get("retry-after"));
    backoffUntil.set(target.host, Date.now() + (after > 0 && after < 86_400 ? after * 1000 : HOST_BACKOFF_MS));
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
