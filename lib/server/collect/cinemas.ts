import "server-only";
import { localDay } from "../events";
import { decodeEntities, fetchText } from "./fetch";

// Парсеры расписаний кинотеатров (docs/CINEMA_SOURCES.md) — без ИИ: сеансы и так структурированы в HTML
// или в данных страницы. Один сеанс — одна строка импорта с постоянным externalId: перенос времени обновляет
// событие, а не создаёт новое. Площадку и город подставляет источник (venueName, city).
// Ссылка на источник — страница расписания или фильма на официальном сайте: на ней видно этот сеанс.
// Нагрузка на сайты: сбор раз в сутки, запросы по одному с паузой 3 с к одному сайту (fetchText), при ошибке обход
// сайта прекращается до следующего запуска. Сайт с расписанием на главной — 1 запрос; по дням — до 5; «Синема 5» —
// главная и страницы фильмов (до 40).

type Row = Record<string, unknown>;

export type Session = {
  id: string; // код сеанса на сайте
  title: string;
  date: string; // YYYY-MM-DD — день расписания (у кинотеатров ночные сеансы относятся к предыдущему дню)
  time: string; // HH:MM
  sourceUrl: string;
  ticketUrl?: string;
  price?: number | null;
  age?: number | null;
  genre?: string;
  format?: string;
  hall?: string;
  durationMin?: number | null;
  imageUrl?: string;
  pushkin?: boolean;
  description?: string;
  exact?: Date; // точное начало, если сайт его даёт (тогда date/time только для подписи)
};

/** Сколько дней расписания собирать: дальше кинотеатры обычно ещё не публикуют сеансы. */
export const CINEMA_DAYS = 5;
/** Сеанс раньше этого часа — ночной: по календарю он уже на следующий день. */
const NIGHT_HOUR = 5;

export const clean = (s: string | undefined | null) => decodeEntities((s ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
export const price = (s: string | undefined | null) => {
  const n = Number((s ?? "").replace(/[^\d]/g, ""));
  return (s ?? "").match(/\d/) && n > 0 && n < 100_000 ? n : null;
};
export const age = (s: string | undefined | null) => {
  const m = (s ?? "").match(/(\d{1,2})\s*\+?/);
  return m && Number(m[1]) <= 21 ? Number(m[1]) : null;
};
/** «2 ч 20 мин», «2 ч. 20 мин.», «140 мин» → минуты. */
export const duration = (s: string | undefined | null) => {
  const t = s ?? "";
  const h = t.match(/(\d+)\s*ч/), m = t.match(/(\d+)\s*мин/);
  const total = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  return total >= 20 && total <= 600 ? total : null;
};
const pick = (s: string, re: RegExp) => s.match(re)?.[1];

/** Ближайшие дни расписания по Уфе: YYYY-MM-DD. */
export const scheduleDays = (n = CINEMA_DAYS, now = new Date()) => Array.from({ length: n }, (_, i) => localDay(i, now));

const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
/** «14 ноября» → YYYY-MM-DD; год — ближайший (в декабре январские даты — следующего года). */
export function dayFromWords(text: string, now = new Date()): string | null {
  const m = text.toLowerCase().match(/(\d{1,2})\s+([а-яё]+)/);
  if (!m) return null;
  const month = MONTHS.findIndex((p, i) => (i === 4 ? /^ма[йя]$/.test(m[2]) : m[2].startsWith(p)));
  if (month < 0) return null;
  const today = localDay(0, now);
  let year = Number(today.slice(0, 4));
  if (month + 1 < Number(today.slice(5, 7)) - 6) year++;
  return `${year}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Начало сеанса: время Уфы; ночной сеанс дня D — это D+1. */
export function sessionStart(date: string, time: string): Date {
  const [h, mi] = time.split(":").map(Number);
  const d = new Date(`${date}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00+05:00`);
  return h < NIGHT_HOUR ? new Date(d.getTime() + 86_400_000) : d;
}

const iso = (d: Date) => new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 19) + "+05:00";

/** Сеансы → строки импорта: без прошедших и повторов. */
export function sessionRows(prefix: string, sessions: Session[], now = new Date()): Row[] {
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const s of sessions) {
    const title = s.title.replace(/\s+/g, " ").trim();
    if (!title || !/^\d{1,2}:\d\d$/.test(s.time) && !s.exact) continue;
    const start = s.exact ?? sessionStart(s.date, s.time);
    if (isNaN(start.getTime()) || start < now) continue;
    const externalId = `${prefix}:${s.id}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    const details = [s.format, s.hall].filter(Boolean).join(", ");
    rows.push({
      externalId,
      title,
      dateStart: iso(start),
      sourceUrl: s.sourceUrl,
      ...(s.ticketUrl ? { ticketUrl: s.ticketUrl } : {}),
      ...(s.price != null ? { priceMin: s.price } : {}),
      ...(s.age != null ? { ageLimit: s.age } : {}),
      ...(s.durationMin ? { durationMin: s.durationMin } : {}),
      ...(s.imageUrl?.startsWith("https://") ? { imageUrl: s.imageUrl } : {}),
      ...(s.pushkin ? { pushkin: true } : {}),
      category: "cinema",
      description: [s.description, s.genre && `Жанр: ${s.genre}.`, details && `Сеанс: ${details}.`].filter(Boolean).join(" ").slice(0, 5000) || undefined,
      tags: ["кино", s.genre, s.format].filter(Boolean).join(", "),
    });
  }
  return rows;
}

/**
 * Загрузить страницы по дням, по одной (паузы между запросами — в fetchText). Первая ошибка останавливает обход
 * сайта в этом запуске: не долбим сайт, который не отвечает; уже загруженные дни сохраняются.
 */
async function perDay<T>(days: string[], load: (day: string) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (const [i, day] of days.entries()) {
    try {
      out.push(...(await load(day)));
    } catch (e) {
      if (!i) throw e;
      break;
    }
  }
  return out;
}

const dmy = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
const abs = (href: string, base: string) => new URL(decodeEntities(href), base).toString();

// ─── Premierzal: «Кинопорт», «Фонтан», «Металлург» (…/schedule?date=ДД.ММ.ГГГГ) ───────────────────────────
export function parsePremierzal(html: string, pageUrl: string): Session[] {
  const out: Session[] = [];
  for (const block of html.split('<div class="schedule__item">').slice(1)) {
    const title = clean(pick(block, /class="film-mini__title">([\s\S]*?)<\/a>/));
    const href = pick(block, /href="(\/schedule\/[^"]+)"/);
    const filmUrl = href ? abs(href, pageUrl) : pageUrl;
    const common = {
      title,
      genre: clean(pick(block, /film-mini__genre">([\s\S]*?)<\/div>/)) || undefined,
      age: age(pick(block, /class="film__label">([^<]*)</)),
      imageUrl: pick(block, /film-mini__poster-wrapper">\s*<img src="([^"]+)"/),
      pushkin: block.includes("film-mini__pushkin"),
    };
    for (const group of block.split('<div class="schedule__session">').slice(1)) {
      const format = clean(pick(group, /schedule__session-format">([\s\S]*?)<\/div>/)) || undefined;
      for (const item of group.split(/(?=<div\s+class="schedule__session-time)/).slice(1)) {
        const id = pick(item, /data-session-id="([^"]+)"/);
        const date = item.match(/data-film-date="(\d\d)\.(\d\d)\.(\d{4})"/);
        const time = pick(item, /class="value">\s*(\d{1,2}:\d\d)/);
        if (!id || !date || !time) continue;
        out.push({ ...common, id, date: `${date[3]}-${date[2]}-${date[1]}`, time, format, price: price(pick(item, /item-price">([\s\S]*?)<\/div>/)), sourceUrl: filmUrl });
      }
    }
  }
  return out;
}

async function runPremierzal(url: string) {
  const base = new URL(url);
  const sessions = await perDay(scheduleDays(), async (day) => {
    const page = new URL(base);
    page.searchParams.set("date", dmy(day));
    const { text, finalUrl } = await fetchText(page.toString(), { accept: "text/html", cookies: true });
    return parsePremierzal(text, finalUrl);
  });
  return sessionRows(`premierzal:${base.hostname}`, sessions);
}

// ─── Kinoplan на сайте «Родины»: главная, 4 дня расписания в одной странице ─────────────────────────────
export function parseRodina(html: string, pageUrl: string): Session[] {
  const out: Session[] = [];
  for (const tile of html.split('<div class="movies-tile ').slice(1)) {
    const title = clean(pick(tile, /movies-tile-title">([\s\S]*?)<\/div>/));
    const href = pick(tile, /href="([^"]+)" class="movies-tile-general"/);
    const common = {
      title,
      genre: clean(pick(tile, /movies-tile-genre">([\s\S]*?)<\/div>/)) || undefined,
      age: age(pick(tile, /movie-age-label[^"]*">([^<]*)</)),
      imageUrl: (() => { const src = pick(tile, /movies-tile-poster">[\s\S]*?data-src="([^"]+)"/); return src ? abs(src, pageUrl) : undefined; })(),
      sourceUrl: href ? abs(href, pageUrl) : pageUrl,
    };
    for (const m of tile.matchAll(/data-date="(\d{4}-\d\d-\d\d)"[^>]*?data-seance-id="([^"]+)"[^>]*>\s*<div class="movie-session-time">(\d{1,2}:\d\d)<\/div>(?:\s*<div class="movie-session-cost">([^<]*)<\/div>)?/g)) {
      out.push({ ...common, id: m[2], date: m[1], time: m[3], price: price(m[4]) });
    }
  }
  return out;
}

async function runRodina(url: string) {
  const { text, finalUrl } = await fetchText(url, { accept: "text/html" });
  return sessionRows(`kinoplan:${new URL(url).hostname}`, parseRodina(text, finalUrl));
}

// ─── Ultra Cinema (Kinoplan, React): /?date=ГГГГ-ММ-ДД ─────────────────────────────────────────────────
export function parseUltra(html: string, pageUrl: string, day: string): Session[] {
  const out: Session[] = [];
  for (const card of html.split('<article class="frow').slice(1)) {
    const title = clean(pick(card, /class="frow__title"[^>]*>([\s\S]*?)<\/a>/));
    const href = pick(card, /class="frow__title" href="([^"]+)"/);
    const meta = clean(pick(card, /class="frow__meta">([\s\S]*?)<\/span>/));
    const common = {
      title,
      genre: meta.split("·")[0]?.trim() || undefined,
      durationMin: duration(meta),
      age: age(pick(card, /class="frow__age">([^<]*)</)),
      imageUrl: pick(card, /class="frow__poster[^"]*"[^>]*><img src="([^"]+)"/),
      sourceUrl: href ? abs(href, pageUrl) : pageUrl,
    };
    for (const group of card.split('<div class="frow__group">').slice(1)) {
      const format = clean(pick(group, /class="frow__fmt">([^<]*)</)) || undefined;
      for (const m of group.matchAll(/aria-label="([^"]+)"[^>]*data-seance-id="([^"]+)"/g)) {
        const [time, ...rest] = decodeEntities(m[1]).split(",").map((s) => s.trim());
        out.push({ ...common, id: m[2], date: day, time, format, hall: rest.find((s) => /зал/i.test(s)), price: price(rest.find((s) => /₽|руб/i.test(s))) });
      }
    }
  }
  return out;
}

async function runUltra(url: string) {
  const origin = new URL(url).origin;
  const sessions = await perDay(scheduleDays(), async (day) => {
    const { text, finalUrl } = await fetchText(`${origin}/?date=${day}`, { accept: "text/html" });
    return parseUltra(text, finalUrl, day);
  });
  return sessionRows(`ultra:${new URL(url).hostname}`, sessions);
}

// ─── «Синема Парк» (kinoteatr.ru): страница кинотеатра ?date=ГГГГ-ММ-ДД ─────────────────────────────────
export function parseCinemaPark(html: string, pageUrl: string, day: string): Session[] {
  const out: Session[] = [];
  for (const block of html.split('<div class="shedule_movie bordered').slice(1)) {
    const title = clean(pick(block, /data-gtm-ga4-list-item-name="([^"]*)"/)) || clean(pick(block, /movie_card_header title">([\s\S]*?)<\/span>/));
    const head = pick(block, /movie_card_raiting sub_title">([\s\S]*?)<\/span>/) ?? "";
    const common = {
      title,
      age: age(pick(head, /raiting_sub">([^<]*)</)),
      genre: clean(head.replace(/<i[\s\S]*?<\/i>/, "")) || undefined,
      durationMin: duration(pick(block, /<span class="title">([\s\S]*?)<\/span>/)),
      imageUrl: pick(block, /shedule_movie_img[^"]*" data-src="([^"]+)"/),
      sourceUrl: pageUrl,
    };
    for (const seg of block.split(/(?=<a\s+href="[^"]*openWidget=)/).slice(1)) {
      const id = pick(seg, /openWidget=(\d+)/);
      const time = pick(seg, /shedule_session_time">\s*(\d{1,2}:\d\d)/);
      if (!id || !time) continue;
      const formats = [...seg.split("</a>")[0].matchAll(/shedule_session_format">([\s\S]*?)<\/span>/g)].map((m) => clean(m[1])).filter(Boolean);
      out.push({ ...common, id, date: day, time, format: formats.join(", ") || undefined, price: price(pick(seg, /shedule_session_price">([\s\S]*?)<\/span>/)) });
    }
  }
  return out;
}

async function runCinemaPark(url: string) {
  const base = new URL(url);
  base.search = "";
  const sessions = await perDay(scheduleDays(), async (day) => {
    const page = `${base.toString()}?date=${day}`;
    const { text } = await fetchText(page, { accept: "text/html" });
    return parseCinemaPark(text, page, day);
  });
  return sessionRows(`cinemapark:${base.pathname}`, sessions);
}

// ─── «Мираж»: /<город>/schedule/ДД.ММ.ГГГГ/ ─────────────────────────────────────────────────────────────
export function parseMirage(html: string, pageUrl: string, day: string): Session[] {
  const out: Session[] = [];
  for (const box of html.split('<div class="session-box">').slice(1)) {
    for (const s of box.split('<div class="session">').slice(1)) {
      const href = pick(s, /href="(\/ticket_new\/([^"/]+)\/?)"/);
      const id = pick(s, /href="\/ticket_new\/([^"/]+)/);
      const time = pick(s, /<div class="time">\s*(\d{1,2}:\d\d)/);
      if (!id || !time) continue;
      const prices = [...(pick(s, /class="place-price">([\s\S]*?)<\/a>/) ?? "").matchAll(/(\d[\d\s]*)₽/g)].map((m) => price(m[1])).filter((n): n is number => n != null);
      out.push({
        id,
        title: clean(pick(s, /<div class="title">([\s\S]*?)<\/div>/)),
        date: day,
        time,
        genre: clean(pick(s, /<div class="genre">([\s\S]*?)<\/div>/)) || undefined,
        hall: clean(pick(s, /<div class="labels">([\s\S]*?)<\/div>/)) || undefined,
        age: age(pick(s, /<div class="age">([^<]*)</)),
        format: clean(pick(s, /<div class="format">([^<]*)</)) || undefined,
        imageUrl: pick(s, /<div class="photo">\s*<img src="([^"]+)"/),
        price: prices.length ? Math.min(...prices) : null,
        sourceUrl: pageUrl,
        ticketUrl: href ? abs(href, pageUrl) : undefined,
      });
    }
  }
  return out;
}

async function runMirage(url: string) {
  const base = url.replace(/\/?$/, "/").replace(/\d\d\.\d\d\.\d{4}\/$/, "");
  const sessions = await perDay(scheduleDays(), async (day) => {
    const page = `${base}${dmy(day)}/`;
    const { text } = await fetchText(page, { accept: "text/html" });
    return parseMirage(text, page, day);
  });
  return sessionRows(`mirage:${new URL(base).pathname}`, sessions);
}

// ─── «Мир кино» (платформа p24, Next.js): расписание — JSON в данных страницы ─────────────────────────
/** JSON-фрагмент со сбалансированными скобками, начиная с позиции start. */
function balanced(str: string, start: number): string | null {
  let depth = 0, inStr = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (!depth) return str.slice(start, i + 1); }
  }
  return null;
}

type P24Show = { uuid: string; date: string; realDate?: number; hall?: string; formats?: string[]; prices?: { price: number }[]; isPushkinCard?: boolean };
type P24Event = { href: string; type?: string; isPushkinCard?: boolean; schedule?: Record<string, Record<string, Record<string, Record<string, P24Show[]>>>>; info?: { name?: string; ageRest?: string; duration?: number; poster?: string; genre?: string[]; description?: string } };

export function parseP24(html: string, pageUrl: string): Session[] {
  let flight = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { flight += JSON.parse(m[1]); } catch { /* повреждённый кусок — пропускаем */ }
  }
  const at = flight.indexOf('"afisha":{');
  const raw = at >= 0 ? balanced(flight, at + 9) : null;
  if (!raw) throw new Error("на странице нет расписания (структура сайта изменилась?)");
  const events = (JSON.parse(raw) as { events?: P24Event[] }).events ?? [];
  const out: Session[] = [];
  for (const e of events) {
    const info = e.info ?? {};
    if (!info.name) continue;
    const common = {
      title: info.name,
      age: age(info.ageRest),
      durationMin: info.duration && info.duration >= 20 ? info.duration : null,
      genre: info.genre?.join(", ") || undefined,
      imageUrl: info.poster,
      description: info.description ? clean(info.description).slice(0, 1000) : undefined,
      sourceUrl: abs(`/events/${encodeURIComponent(e.href)}`, pageUrl),
    };
    for (const byCity of Object.values(e.schedule ?? {})) for (const byPlace of Object.values(byCity)) for (const byHall of Object.values(byPlace)) for (const shows of Object.values(byHall)) {
      for (const s of shows) {
        const m = s.date?.match(/^(\d{4})\/(\d\d)\/(\d\d) (\d{1,2}:\d\d)$/);
        if (!m) continue;
        const prices = (s.prices ?? []).map((p) => p.price).filter((n) => n > 0);
        out.push({ ...common, id: s.uuid, date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4], exact: s.realDate ? new Date(s.realDate) : undefined, hall: s.hall, format: s.formats?.join(", "), price: prices.length ? Math.min(...prices) : null, pushkin: s.isPushkinCard ?? e.isPushkinCard });
      }
    }
  }
  return out;
}

async function runP24(url: string) {
  const { text, finalUrl } = await fetchText(url, { accept: "text/html" });
  return sessionRows(`p24:${new URL(url).hostname}`, parseP24(text, finalUrl));
}

// ─── «Синема 5» (cinemabox, Nuxt): главная → страницы фильмов, на каждой 5 дней сеансов ────────────────
/** Данные Nuxt (devalue): массив, где объекты ссылаются на элементы по индексу. */
export function nuxtPayload(html: string): unknown {
  const json = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!json) return null;
  const raw = JSON.parse(json) as unknown[];
  const memo = new Map<number, unknown>();
  const WRAP = new Set(["Reactive", "ShallowReactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef", "NuxtError"]);
  const rv = (i: unknown): unknown => {
    if (typeof i !== "number" || i < 0 || i >= raw.length) return undefined;
    if (memo.has(i)) return memo.get(i);
    const v = raw[i];
    if (Array.isArray(v)) {
      if (typeof v[0] === "string" && WRAP.has(v[0])) { const r = rv(v[1]); memo.set(i, r); return r; }
      if (v[0] === "Date") return v[1];
      if (v[0] === "Set" || v[0] === "Map") return v.slice(1).map(rv);
      const out: unknown[] = [];
      memo.set(i, out);
      for (const x of v) out.push(rv(x));
      return out;
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      memo.set(i, out);
      for (const [k, x] of Object.entries(v)) out[k] = rv(x);
      return out;
    }
    memo.set(i, v);
    return v;
  };
  return rv(0);
}

type C5Show = { id: number; date: string; time: string; formatName?: string; hallName?: string; hallCategory?: string; minPrice?: number };
type C5Movie = { id: number; name?: string; description?: string; duration?: number; ageRating?: number | string; age?: number | string; genres?: { name?: string }[] | string[]; dates?: { cinemas?: { shows?: C5Show[] }[] }[] };

export function parseCinema5Movie(html: string, pageUrl: string): Session[] {
  const root = nuxtPayload(html);
  let movie: C5Movie | null = null;
  const seen = new Set<unknown>();
  const walk = (o: unknown) => {
    if (movie || !o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    const m = o as C5Movie;
    if (typeof m.name === "string" && Array.isArray(m.dates)) { movie = m; return; }
    for (const v of Object.values(o)) walk(v);
  };
  walk(root);
  if (!movie) return [];
  const mv = movie as C5Movie;
  const genre = (mv.genres ?? []).map((g) => (typeof g === "string" ? g : g?.name)).filter(Boolean).join(", ") || undefined;
  const out: Session[] = [];
  for (const d of mv.dates ?? []) for (const c of d.cinemas ?? []) for (const s of c.shows ?? []) {
    if (!/^\d{4}-\d\d-\d\d$/.test(s.date) || !/^\d{1,2}:\d\d$/.test(s.time)) continue;
    out.push({
      id: String(s.id),
      title: mv.name!,
      date: s.date,
      time: s.time,
      format: s.formatName,
      hall: [s.hallName && `Зал ${s.hallName}`, s.hallCategory].filter(Boolean).join(", ") || undefined,
      price: s.minPrice && s.minPrice > 0 ? s.minPrice : null,
      age: age(String(mv.ageRating ?? mv.age ?? "")),
      durationMin: mv.duration && mv.duration >= 20 ? mv.duration : null,
      genre,
      description: mv.description ? clean(mv.description).slice(0, 1000) : undefined,
      sourceUrl: pageUrl,
    });
  }
  return out;
}

async function runCinema5(url: string) {
  const { text, finalUrl } = await fetchText(url, { accept: "text/html" });
  const prefix = new URL(finalUrl).pathname.replace(/\/$/, "");
  const links = [...new Set([...text.matchAll(/href="(\/[a-z-]+\/movie\/[^"?#]+)"/g)].map((m) => m[1]).filter((h) => h.startsWith(`${prefix}/movie/`)))].slice(0, 40);
  if (!links.length) throw new Error("на странице нет ссылок на фильмы");
  const sessions: Session[] = [];
  let ok = 0, errors = 0;
  for (const href of links) {
    const page = abs(href, finalUrl);
    try {
      const { text: movie } = await fetchText(page, { accept: "text/html" });
      sessions.push(...parseCinema5Movie(movie, page));
      ok++;
    } catch {
      // Фильм без страницы — пропускаем; две ошибки подряд — сайт не в порядке, до следующего запуска не трогаем
      if (++errors >= 2) break;
      continue;
    }
    errors = 0;
  }
  if (!ok) throw new Error("страницы фильмов не загрузились");
  return sessionRows(`cinemabox:${new URL(finalUrl).hostname}${prefix}`, sessions);
}

// ─── «Арсенал» (Нефтекамск): главная, вкладки дней с фильмами и сеансами ────────────────────────────────
export function parseArsenal(html: string, pageUrl: string, now = new Date()): Session[] {
  const flat = html.replace(/\s+/g, " ");
  const tabDays = new Map<string, string>();
  for (const m of flat.matchAll(/href="#(tab\d+)" class="timetable__tab-link">([\s\S]*?)<\/a>/g)) {
    const day = dayFromWords(clean(m[2]), now);
    if (day) tabDays.set(m[1], day);
  }
  const out: Session[] = [];
  for (const pane of flat.split('class="timetable__tab-pane').slice(1)) {
    const day = tabDays.get(pick(pane, /id="(tab\d+)"/) ?? "");
    if (!day) continue;
    for (const film of pane.split('class="timetable__film-wrp"').slice(1)) {
      const href = pick(film, /<a href="([^"]+)">\s*<h2 class="timetable__title">/);
      const title = clean(pick(film, /class="timetable__title">([\s\S]*?)<\/h2>/));
      const genreP = [...(pick(film, /class="timetable__genre">([\s\S]*?)<\/div>/) ?? "").matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => clean(m[1]));
      const img = pick(film, /class="timetable__poster">[\s\S]*?<img src="([^"]+)"/);
      const common = {
        title,
        age: age(pick(film, /timetable__pegi[^"]*">([^<]*)</)),
        genre: genreP.at(-1) || undefined,
        imageUrl: img ? abs(img, pageUrl) : undefined,
        pushkin: film.includes("timetable__pushkin_active"),
        sourceUrl: href ? abs(href, pageUrl) : pageUrl,
      };
      for (const m of film.matchAll(/timetable__time">\s*(\d{1,2}:\d\d)\s*<\/p>\s*<p class="timetable__price">([^<]*)</g)) {
        out.push({ ...common, id: `${day}:${m[1]}:${href ?? title}`, date: day, time: m[1], price: price(m[2]) });
      }
    }
  }
  return out;
}

async function runArsenal(url: string) {
  const { text, finalUrl } = await fetchText(url, { accept: "text/html" });
  return sessionRows(`arsenal:${new URL(url).hostname}`, parseArsenal(text, finalUrl));
}

/** Парсеры кинотеатров для ADAPTERS (lib/server/collect/adapters.ts). */
export const CINEMA_ADAPTERS = {
  "cinema-premierzal": { name: "Кинотеатр на Premierzal", description: "«Кинопорт», «Фонтан», «Металлург»: адрес — страница /schedule сайта; 5 дней расписания", run: runPremierzal },
  "cinema-rodina": { name: "Кинотеатр «Родина» (Kinoplan)", description: "Главная rodina-ufa.ru: 4 дня сеансов", run: runRodina },
  "cinema-ultra": { name: "Ultra Cinema (Kinoplan)", description: "Сайты *.ultra-cinema.ru: адрес — главная кинотеатра; 5 дней расписания", run: runUltra },
  "cinema-cinemapark": { name: "Синема Парк (kinoteatr.ru)", description: "Адрес — страница кинотеатра в разделе «Расписание кинотеатров»; 5 дней", run: runCinemaPark },
  "cinema-mirage": { name: "Мираж Синема", description: "Адрес — страница расписания города (mirage.ru/<город>/schedule/); 5 дней", run: runMirage },
  "cinema-p24": { name: "Кинотеатр на платформе p24", description: "«Мир кино» (Белебей): главная с расписанием на ближайшие дни", run: runP24 },
  "cinema-cinemabox": { name: "Кинотеатр на cinemabox", description: "«Синема 5»: адрес — страница города (cinema5.ru/ufa); сеансы со страниц фильмов", run: runCinema5 },
  "cinema-arsenal": { name: "Кинотеатр «Арсенал»", description: "arsenal-club.com: главная, вкладки дней", run: runArsenal },
};
