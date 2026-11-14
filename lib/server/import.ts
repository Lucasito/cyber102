import "server-only";
import { createHash } from "node:crypto";
import type { EventStatus, Prisma, Publication, SourceType } from "@/generated/prisma/client";
import { audit, diffFields } from "./audit";
import { findDuplicate } from "./dedup";
import { db } from "./db";
import { queueDataChange } from "./data-changes";
import { importVenueLocation, resolveVenue } from "./venue-registry";
import { settlementInBashkortostan } from "./geocode";
import { getSettings } from "./settings";
import { categorySlug, dedupKey, genreTagsFromUrl, inBashkortostan, normalizeCity, normalizeTitle, parseAge, parseBool, parseDate, parseDuration, parsePrice, parseTags, parseUrl, RB_SETTLEMENTS } from "./normalize";

// Импорт событий из CSV/JSON (ТЗ 6.1): валидация, нормализация, дедупликация, идемпотентность, отчёт.
//  • Сырые строки — в RawRecord (отдельно от событий): повторная загрузка той же строки ничего не меняет.
//  • Одно событие из разных источников — одна карточка (dedupKey), источники копятся в EventSource.
//  • Обязательные поля: название, дата начала, город, площадка, ссылка на источник. Нет — строка отклонена.
//  • Нет категории или цены — карточка «спорная»: черновик в очереди модерации, на сайт не попадает.

export const MAX_ROWS = 5000;

export type RowResult = { row: number; result: "created" | "updated" | "unchanged" | "rejected"; reason?: string; eventId?: string; title?: string };
export type ImportReport = { importId: string; total: number; created: number; updated: number; unchanged: number; rejected: number; rows: RowResult[] };

/** Колонка файла → поле. Сравнение без регистра, пробелов, «_» и «-». */
const ALIASES: Record<string, string[]> = {
  externalId: ["id", "externalid", "код"],
  title: ["title", "name", "название", "наименование"],
  description: ["description", "описание", "анонс"],
  dateStart: ["datestart", "start", "startsat", "date", "datetime", "дата", "датаначала", "начало", "датаивремя"],
  dateEnd: ["dateend", "end", "endsat", "датаокончания", "окончание", "конец"],
  durationMin: ["durationmin", "duration", "длительность", "продолжительность"],
  city: ["city", "город", "населенныйпункт", "населённыйпункт"],
  venue: ["venue", "place", "площадка", "место", "учреждение"],
  address: ["address", "адрес"],
  lat: ["lat", "latitude", "широта"],
  lon: ["lon", "lng", "longitude", "долгота"],
  price: ["price", "цена", "стоимость"],
  priceMin: ["pricemin", "ценаот", "минимальнаяцена"],
  priceMax: ["pricemax", "ценадо", "максимальнаяцена"],
  isFree: ["isfree", "free", "бесплатно"],
  ageLimit: ["agelimit", "age", "возраст", "возрастноеограничение"],
  category: ["category", "категория", "тип", "жанр"],
  tags: ["tags", "метки", "теги"],
  language: ["language", "язык"],
  orgUrl: ["orglink", "orgurl", "organizer", "организатор"],
  ticketUrl: ["ticketurl", "tickets", "ticket", "билеты"],
  sourceUrl: ["sourceurl", "source", "url", "link", "источник", "ссылка"],
  imageUrl: ["imageurl", "image", "изображение", "картинка", "фото"],
  status: ["status", "статус"],
  pushkin: ["pushkin", "pushkincard", "пушкинскаякарта"],
};
const keyOf = (k: string) => k.toLowerCase().replace(/[\s_\-.]/g, "");
const FIELD_BY_ALIAS = new Map(Object.entries(ALIASES).flatMap(([field, list]) => list.map((a) => [a, field] as const)));

/** Строка файла → объект по нашим полям (неизвестные колонки игнорируются). */
function mapRow(raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const field = FIELD_BY_ALIAS.get(keyOf(k));
    if (field && v !== "" && v != null && out[field] == null) out[field] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

// ── Разбор файлов ─────────────────────────────────────────────────────────────

/** CSV по RFC 4180: кавычки, переводы строк внутри кавычек; разделитель — «;», «,» или табуляция (по заголовку). */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n/) >>> 0 || src.length);
  const delim = [";", ",", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

/** Содержимое файла → строки. JSON: массив или { events: [...] } / { items: [...] }. */
export function parseFile(content: string, fileName: string): Record<string, unknown>[] {
  const isJson = /\.json$/i.test(fileName) || /^\s*[[{]/.test(content);
  if (!isJson) return parseCsv(content);
  const data = JSON.parse(content.replace(/^﻿/, ""));
  const list = Array.isArray(data) ? data : Array.isArray(data?.events) ? data.events : Array.isArray(data?.items) ? data.items : null;
  if (!list) throw new Error("JSON: ожидается массив событий или объект { events: [...] }");
  return list.filter((x: unknown) => x && typeof x === "object");
}

// ── Нормализация одной строки ─────────────────────────────────────────────────

const STATUS_WORDS: [RegExp, EventStatus | "DRAFT"][] = [
  [/отмен|cancel/, "CANCELLED"],
  [/перенес|перенос|resched/, "RESCHEDULED"],
  [/продан|sold/, "SOLD_OUT"],
  [/черновик|draft/, "DRAFT"],
];

type Normalized = {
  externalId: string | null;
  title: string;
  normalizedTitle: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  durationMin: number | null;
  city: string;
  venue: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  priceMin: number | null;
  priceMax: number | null;
  ageLimit: number | null;
  categorySlug: string | null;
  tags: string[];
  language: string | null;
  orgUrl: string | null;
  ticketUrl: string | null;
  sourceUrl: string;
  imageUrl: string | null;
  status: EventStatus;
  draft: boolean;
  pushkinCard: boolean;
  issues: string[]; // почему карточка спорная
  checkRegion: boolean; // населённого пункта нет в справочнике — проверить регион геокодером
};

function normalizeRow(r: Record<string, unknown>, ctx: { cities: string[]; categories: string[]; now: Date; extraSettlements: string[] }): Normalized | { error: string } {
  const title = typeof r.title === "string" ? r.title.replace(/\s+/g, " ").trim() : "";
  const missing = [
    !title && "название",
    r.dateStart == null && "дата начала",
    !r.city && "город",
    !r.venue && "площадка",
    !r.sourceUrl && "ссылка на источник",
  ].filter(Boolean);
  if (missing.length) return { error: `нет обязательных полей: ${missing.join(", ")}` };
  if (title.length < 3 || title.length > 300) return { error: "название короче 3 или длиннее 300 символов" };
  const startsAt = parseDate(r.dateStart, ctx.now);
  if (!startsAt) return { error: `не удалось разобрать дату начала «${String(r.dateStart)}»` };
  let endsAt = r.dateEnd != null ? parseDate(r.dateEnd, ctx.now) : null;
  if (r.dateEnd != null && !endsAt) return { error: `не удалось разобрать дату окончания «${String(r.dateEnd)}»` };
  // Окончание, равное началу, — заглушка сайта (так у СГТКО и филармонии), а не настоящее время: считаем неизвестным
  if (endsAt && endsAt.getTime() === startsAt.getTime()) endsAt = null;
  if (endsAt && endsAt < startsAt) return { error: "окончание раньше начала" };
  if ((endsAt ?? startsAt).getTime() < ctx.now.getTime()) return { error: "событие уже прошло" };
  const sourceUrl = parseUrl(r.sourceUrl);
  if (!sourceUrl) return { error: "ссылка на источник не похожа на адрес http(s)" };

  let { min: priceMin, max: priceMax } = parsePrice(r.price);
  const pMin = parsePrice(r.priceMin).min;
  const pMax = parsePrice(r.priceMax).max ?? parsePrice(r.priceMax).min;
  if (pMin != null) priceMin = pMin;
  if (pMax != null) priceMax = pMax;
  if (parseBool(r.isFree)) {
    priceMin = 0;
    priceMax = 0;
  }
  if (priceMin != null && priceMax != null && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];
  if (priceMin == null && priceMax != null) priceMin = null;

  const statusText = typeof r.status === "string" ? r.status.toLowerCase() : "";
  const statusHit = STATUS_WORDS.find(([re]) => re.test(statusText))?.[1];
  const lat = r.lat != null ? Number(String(r.lat).replace(",", ".")) : null;
  const lon = r.lon != null ? Number(String(r.lon).replace(",", ".")) : null;
  const duration = parseDuration(r.durationMin);
  const cat = categorySlug(r.category, ctx.categories);
  const city = normalizeCity(String(r.city), ctx.cities);


  const issues: string[] = [];
  if (!cat) issues.push(r.category ? `категория «${String(r.category)}» не из справочника` : "нет категории");
  if (priceMin == null && priceMax == null) issues.push("цена не указана");


  return {
    externalId: r.externalId != null ? String(r.externalId).slice(0, 100) : null,
    title,
    normalizedTitle: normalizeTitle(title),
    description: typeof r.description === "string" ? r.description.slice(0, 5000) : null,
    startsAt,
    endsAt,
    durationMin: duration,
    city,
    venue: String(r.venue).replace(/\s+/g, " ").trim().slice(0, 200),
    address: typeof r.address === "string" ? r.address.slice(0, 300) : null,
    lat: lat != null && Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
    lon: lon != null && Number.isFinite(lon) && Math.abs(lon) <= 180 ? lon : null,
    priceMin,
    priceMax,
    ageLimit: parseAge(r.ageLimit),
    categorySlug: cat,
    tags: [...new Set([...parseTags(r.tags), ...genreTagsFromUrl(sourceUrl)])],
    language: typeof r.language === "string" ? r.language.toLowerCase().slice(0, 40) : null,
    orgUrl: parseUrl(r.orgUrl),
    ticketUrl: parseUrl(r.ticketUrl),
    sourceUrl,
    imageUrl: parseUrl(r.imageUrl),
    status: statusHit && statusHit !== "DRAFT" ? statusHit : "SCHEDULED",
    draft: statusHit === "DRAFT",
    pushkinCard: parseBool(r.pushkin) ?? false,
    issues,
    checkRegion: !inBashkortostan(city, ctx.extraSettlements),
  };
}

/** Канонический JSON (ключи по алфавиту) — одинаковые строки дают одинаковый хеш, порядок колонок не важен. */
function hashRow(r: Record<string, unknown>) {
  const sorted = Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/** Площадка по городу и нормализованному названию; нет — создаётся. Пустые адрес и координаты дополняются. */
async function venueFor(tx: Prisma.TransactionClient, n: Normalized, source: string) {
  const venue = await resolveVenue(tx, n.venue, n.city);
  return importVenueLocation(tx, venue, n, source, n.sourceUrl);
}

/** Поля, которые другой источник может дополнить, если у события они пустые. */
const FILL_FIELDS = ["description", "endsAt", "durationMin", "priceMin", "priceMax", "ageLimit", "categoryId", "language", "orgUrl", "ticketUrl", "imageUrl"] as const;

const EVENT_FIELDS = ["title", "description", "startsAt", "endsAt", "durationMin", "status", "priceMin", "priceMax", "ageLimit", "categoryId", "venueId", "tags", "language", "orgUrl", "ticketUrl", "imageUrl", "pushkinCard"] as const;

export type ImportOptions = {
  fileName: string;
  source: string;
  sourceType?: SourceType;
  userLogin: string | null;
  /**
   * Недоверенные данные (организатор, разбор ИИ, источник без автопубликации): новые события — только черновиком
   * в очередь модерации с этой пометкой, уже существующие не меняются (иначе это обход модерации).
   */
  review?: string;
  /** Кто добавил — организатор видит свои события. */
  createdById?: string;
  /** Проверить, что ссылка на источник отвечает (сборщики); не отвечает — в модерацию. */
  verifyLinks?: boolean;
};

/** Ссылка отвечает? HEAD, при отказе — GET; код < 400 — да. */
export async function urlAlive(url: string): Promise<{ ok: boolean; status: number }> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "AfishaRB/1.0 (+https://afisha.193-47-33-213.sslip.io)" } });
      if (res.status < 400) return { ok: true, status: res.status };
      if (method === "GET" || ![403, 405, 501].includes(res.status)) return { ok: false, status: res.status };
    } catch {
      if (method === "GET") return { ok: false, status: 0 };
    }
  }
  return { ok: false, status: 0 };
}

export type ValidatedRow = { row: number; ok: boolean; title?: string; startsAt?: string; city?: string; venue?: string; issues: string[]; error?: string };

/** Проверка строк без записи в базу — для страницы универсального формата и предпросмотра источника. */
export async function validateRows(rows: Record<string, unknown>[]): Promise<ValidatedRow[]> {
  const categories = await db.category.findMany({ select: { slug: true } });
  const extraSettlements = (await getSettings("tuning")).extraSettlements;
  const ctx = { cities: [...new Set([...RB_SETTLEMENTS, ...extraSettlements])], categories: categories.map((c) => c.slug), now: new Date(), extraSettlements };
  return rows.slice(0, MAX_ROWS).map((raw, i) => {
    const mapped = mapRow(raw);
    const n = normalizeRow(mapped, ctx);
    if ("error" in n) return { row: i + 1, ok: false, title: typeof mapped.title === "string" ? mapped.title : undefined, issues: [], error: n.error };
    const issues = [...n.issues, ...(n.checkRegion ? [`населённого пункта «${n.city}» нет в справочнике РБ — проверим по карте`] : [])];
    return { row: i + 1, ok: true, title: n.title, startsAt: n.startsAt.toISOString(), city: n.city, venue: n.venue, issues };
  });
}

/**
 * Импорт строк. source — код источника (например, «minkult» или имя файла), sourceType — IMPORT для файлов,
 * RSS/API/PAGE — для сборщиков. Возвращает отчёт; итог и строки отчёта сохраняются в ImportRun.
 */
export async function importRows(rows: Record<string, unknown>[], opts: ImportOptions): Promise<ImportReport> {
  if (rows.length > MAX_ROWS) throw new Error(`Слишком много строк: ${rows.length}, не больше ${MAX_ROWS} за раз`);
  const sourceType = opts.sourceType ?? "IMPORT";
  const source = opts.source.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 60) || "import";
  const categories = await db.category.findMany({ select: { id: true, slug: true } });
  // Справочник для исправления опечаток: населённые пункты РБ и города уже известных площадок
  const extraSettlements = (await getSettings("tuning")).extraSettlements;
  const ctx = { cities: [...new Set([...RB_SETTLEMENTS, ...extraSettlements])], categories: categories.map((c) => c.slug), now: new Date(), extraSettlements };
  const categoryId = new Map(categories.map((c) => [c.slug, c.id]));

  const run = await db.importRun.create({ data: { fileName: opts.fileName.slice(0, 200), source, total: rows.length, report: [], userLogin: opts.userLogin } });
  const report: RowResult[] = [];
  const seenInFile = new Map<string, number>();
  const regionCache = new Map<string, boolean | null>();
  const linkCache = new Map<string, { ok: boolean; status: number }>();

  for (const [i, raw] of rows.entries()) {
    const rowNo = i + 2; // как в таблице: строка 1 — заголовок
    const hash = hashRow(raw);
    try {
      // Та же строка уже загружалась и стала событием — ничего не делаем (идемпотентность)
      const known = await db.rawRecord.findUnique({ where: { source_hash: { source, hash } } });
      if (known?.eventId && !opts.verifyLinks && (await db.event.count({ where: { id: known.eventId } }))) {
        report.push({ row: rowNo, result: "unchanged", eventId: known.eventId, reason: "строка уже загружалась" });
        continue;
      }
      const mapped = mapRow(raw);
      const n = normalizeRow(mapped, ctx);
      // Афиша — только о событиях в Башкортостане (ТЗ 1): пункта нет в справочнике — спрашиваем геокодер.
      // Вне РБ — пропускаем; геокодер недоступен — не теряем событие, а отправляем на проверку модератору.
      if (!("error" in n) && n.checkRegion) {
        const inRb = regionCache.has(n.city) ? regionCache.get(n.city)! : await settlementInBashkortostan(n.city);
        regionCache.set(n.city, inRb);
        if (inRb === false) Object.assign(n, { error: `вне Башкортостана: «${n.city}»` });
        else if (inRb === null) n.issues.push(`регион «${n.city}» не проверен — геокодер недоступен`);
      }
      // Проверка сборщика: ссылка на источник отвечает
      if (!("error" in n) && opts.verifyLinks) {
        const alive = linkCache.get(n.sourceUrl) ?? (await urlAlive(n.sourceUrl));
        linkCache.set(n.sourceUrl, alive);
        if (!alive.ok) n.issues.push(`ссылка на источник не отвечает${alive.status ? ` (код ${alive.status})` : ""}`);
      }
      if (!("error" in n) && opts.review) {
        n.issues.unshift(opts.review);
        // Возраст в источниках часто не указан — модератор допишет, если он известен (иначе событие без пометки
        // показывается при фильтре по возрасту в конце, с надписью «возраст не указан»)
        if (n.ageLimit == null) n.issues.push("возраст не указан — допишите, если известен");
      }
      if ("error" in n) {
        await db.rawRecord.upsert({
          where: { source_hash: { source, hash } },
          create: { source, sourceType, hash, payload: raw as Prisma.InputJsonValue, importId: run.id, error: n.error },
          update: { importId: run.id, error: n.error },
        });
        report.push({ row: rowNo, result: "rejected", reason: n.error, title: typeof mapped.title === "string" ? mapped.title : undefined });
        continue;
      }

      const key = dedupKey(n.title, n.startsAt, n.venue, n.city);
      const result = await db.$transaction(async (tx) => {
        const venue = await venueFor(tx, n, source);
        const canonicalKey = dedupKey(n.title, n.startsAt, venue.name, venue.city);
        // Своё событие источника: по externalId (переживает перенос даты) или по ключу дедупликации
        const sameExternal = n.externalId ? await tx.eventSource.findMany({ where: { source, externalId: n.externalId }, select: { eventId: true, event: { select: { startsAt: true } } } }) : [];
        const rowsAtUrl = rows.filter((r) => { const m = mapRow(r); return m.sourceUrl === n.sourceUrl && normalizeTitle(String(m.title ?? "")) === n.normalizedTitle; }).length;
        const sameTime = sameExternal.find((s) => s.event.startsAt.getTime() === n.startsAt.getTime());
        let bySource: { eventId: string } | null = sameTime ?? (sameExternal.length === 1 && rowsAtUrl === 1 ? sameExternal[0] : null);
        // Перенос при старом формате externalId (включал дату): только однозначная карточка источника.
        if (!bySource) {
          const sameUrl = await tx.eventSource.findMany({ where: { source, url: n.sourceUrl, event: { normalizedTitle: n.normalizedTitle, status: { not: "PAST" } } }, select: { eventId: true } });
          const ids = [...new Set(sameUrl.map((s) => s.eventId))];
          if (ids.length === 1 && rowsAtUrl === 1) bySource = { eventId: ids[0] };
        }
        let existing = bySource
          ? await tx.event.findUnique({ where: { id: bySource.eventId } })
          : await tx.event.findFirst({ where: { OR: [{ dedupKey: canonicalKey }, { normalizedTitle: n.normalizedTitle, venueId: venue.id, startsAt: n.startsAt }] } });
        // Нечёткий поиск дубля из другого источника: «Спектакль «X»» и «X / перевод», площадка названа по-разному
        // Кроме кино: один фильм в одно время идёт во многих кинотеатрах (и у сетей общее слово в названии площадки —
        // «Синема Парк», «Ultra Cinema»), а сеансы одного кинотеатра различает externalId источника
        const fuzzy = existing || n.categorySlug === "cinema" ? null : await findDuplicate(tx, { title: n.title, startsAt: n.startsAt, endsAt: n.endsAt, city: n.city, venue: n.venue });
        if (fuzzy?.level === "same") existing = await tx.event.findUnique({ where: { id: fuzzy.id } });
        else if (fuzzy) {
          n.issues.push(`возможный дубль «${fuzzy.title}» (${fuzzy.venueName ?? "площадка не указана"})`);
        }
        // «Своё» событие источника можно обновлять; чужое (то же событие из другого источника) — только дополнять пустые поля,
        // иначе два источника с разной ценой или описанием переписывали бы карточку друг за другом на каждом сборе
        const own = !!existing && (!!bySource || (await tx.eventSource.count({ where: { eventId: existing.id, source } })) > 0);

        const rescheduled = existing && existing.startsAt.getTime() !== n.startsAt.getTime() && bySource;
        const data = {
          title: n.title,
          normalizedTitle: n.normalizedTitle,
          description: n.description ?? existing?.description ?? null,
          startsAt: n.startsAt,
          // Пустое значение из источника не затирает уже известное (другой источник мог быть полнее)
          endsAt: n.endsAt ?? existing?.endsAt ?? null,
          durationMin: n.durationMin ?? existing?.durationMin ?? null,
          status: rescheduled && n.status === "SCHEDULED" ? ("RESCHEDULED" as const) : mapped.status == null ? (existing?.status ?? n.status) : n.status,
          priceMin: n.priceMin ?? existing?.priceMin ?? null,
          priceMax: n.priceMin != null || n.priceMax != null ? n.priceMax : (existing?.priceMax ?? null),
          ageLimit: n.ageLimit ?? existing?.ageLimit ?? null,
          categoryId: n.categorySlug ? (categoryId.get(n.categorySlug) ?? null) : (existing?.categoryId ?? null),
          venueId: venue.id,
          tags: n.tags.length ? n.tags : (existing?.tags ?? []),
          language: n.language ?? existing?.language ?? null,
          orgUrl: n.orgUrl ?? existing?.orgUrl ?? null,
          ticketUrl: n.ticketUrl ?? existing?.ticketUrl ?? null,
          imageUrl: n.imageUrl ?? existing?.imageUrl ?? null,
          pushkinCard: n.pushkinCard,
        };
        const review = n.issues.length ? { needsReview: true, reviewNote: n.issues.join("; ") } : {};

        let eventId: string;
        let outcome: RowResult["result"];
        if (existing && (opts.review || (opts.verifyLinks && existing.publication === "PUBLISHED"))) {
          const proposed = Object.fromEntries(EVENT_FIELDS.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]));
          const change = await queueDataChange(tx, { entity: "event", entityId: existing.id, source, url: n.sourceUrl, current: existing, proposed });
          if (own) {
            // Ссылка на первоисточник — не содержание карточки: если источник теперь даёт другую страницу для того же
            // сеанса (тот же externalId), ссылка обновляется сразу, без проверки
            if (n.externalId && !(await tx.eventSource.count({ where: { eventId: existing.id, source, url: n.sourceUrl } }))) await tx.eventSource.updateMany({ where: { eventId: existing.id, source, externalId: n.externalId }, data: { url: n.sourceUrl } });
            await tx.eventSource.updateMany({ where: { eventId: existing.id, source, url: n.sourceUrl }, data: { fetchedAt: new Date() } });
          }
          await tx.rawRecord.upsert({ where: { source_hash: { source, hash } },
            create: { source, sourceType, hash, payload: raw as Prisma.InputJsonValue, importId: run.id, eventId: existing.id },
            update: { importId: run.id, eventId: existing.id, error: null },
          });
          return { eventId: existing.id, outcome: "unchanged" as const, skipped: true, mergedInto: own ? null : existing.title, pending: change?.status === "pending" };
        }
        if (!existing) {
          const publication: Publication = n.draft || n.issues.length ? "DRAFT" : "PUBLISHED";
          const created = await tx.event.create({
            data: {
              ...data,
              dedupKey: canonicalKey,
              publication,
              verifiedAt: new Date(),
              confidence: opts.review ? 0.5 : n.issues.length ? 0.7 : 1,
              createdById: opts.createdById ?? null,
              possibleDuplicateId: fuzzy?.level === "possible" ? fuzzy.id : null,
              ...review,
            },
          });
          eventId = created.id;
          outcome = "created";
          await audit({ userLogin: opts.userLogin, action: "import", entity: "event", entityId: eventId, summary: `Импорт «${opts.fileName}», строка ${rowNo}: создано «${n.title}»${n.issues.length ? ` — в модерацию: ${n.issues.join("; ")}` : ""}` }, tx);
        } else if (!own) {
          // То же событие из другого источника: дополняем пустые поля, ссылка на источник добавляется ниже
          eventId = existing.id;
          const fill = Object.fromEntries(
            FILL_FIELDS.filter((k) => (existing as Record<string, unknown>)[k] == null && data[k] != null).map((k) => [k, data[k]]),
          );
          if (Object.keys(fill).length) {
            await tx.event.update({ where: { id: existing.id }, data: fill });
            outcome = "updated";
            await audit({ userLogin: opts.userLogin, action: "import", entity: "event", entityId: eventId, summary: `Импорт «${opts.fileName}», строка ${rowNo}: то же событие из другого источника — дополнено «${existing.title}»` }, tx);
          } else outcome = "unchanged";
        } else {
          eventId = existing.id;
          const diff = diffFields(existing as Record<string, unknown>, data, [...EVENT_FIELDS]);
          if (diff) {
            await tx.event.update({
              where: { id: existing.id },
              data: { ...data, dedupKey: canonicalKey, ...(rescheduled ? { originalStartsAt: existing.originalStartsAt ?? existing.startsAt } : {}), verifiedAt: new Date() },
            });
            outcome = "updated";
            await audit({ userLogin: opts.userLogin, action: "import", entity: "event", entityId: eventId, summary: `Импорт «${opts.fileName}», строка ${rowNo}: обновлено «${n.title}»`, diff }, tx);
          } else outcome = "unchanged";
        }
        // Источник события. Одна ссылка может относиться к нескольким сеансам (страница постановки) — связь своя у каждого
        let link = await tx.eventSource.findFirst({ where: { eventId, source, url: n.sourceUrl } });
        // Тот же сеанс источника (externalId) с прежней страницей — переносим ссылку, а не заводим вторую
        if (!link && n.externalId) link = await tx.eventSource.findFirst({ where: { eventId, source, externalId: n.externalId } });
        if (link && link.url !== n.sourceUrl) link = await tx.eventSource.update({ where: { id: link.id }, data: { url: n.sourceUrl } });
        if (!link) await tx.eventSource.create({ data: { eventId, source, sourceType, url: n.sourceUrl, externalId: n.externalId, sourceHash: hash } });
        else await tx.eventSource.update({ where: { id: link.id }, data: { sourceHash: hash, externalId: n.externalId ?? link.externalId, fetchedAt: new Date() } });
        await tx.rawRecord.upsert({
          where: { source_hash: { source, hash } },
          create: { source, sourceType, hash, payload: raw as Prisma.InputJsonValue, importId: run.id, eventId },
          update: { importId: run.id, eventId, error: null },
        });
        return { eventId, outcome, skipped: false, mergedInto: existing && !own ? existing.title : null };
      });

      const dup = seenInFile.get(key);
      seenInFile.set(key, rowNo);
      report.push({
        row: rowNo,
        result: result.outcome,
        eventId: result.eventId,
        title: n.title,
        reason: "pending" in result && result.pending
          ? "изменения источника ожидают проверки: было → стало в разделе «Модерация»"
          : result.skipped
          ? result.mergedInto
            ? `дубль события «${result.mergedInto}» из другого источника — уже есть в афише`
            : "такое событие уже есть в афише — изменения вносит модератор"
          : result.mergedInto
            ? `то же событие, что «${result.mergedInto}» из другого источника — добавлена ссылка${result.outcome === "updated" ? ", дополнены пустые поля" : ""}`
            : dup
            ? `то же событие, что в строке ${dup} — объединено`
            : result.outcome === "unchanged"
              ? "такое событие уже есть, данные совпадают"
              : n.issues.length
                ? `в модерацию: ${n.issues.join("; ")}`
                : undefined,
      });
    } catch (e) {
      report.push({ row: rowNo, result: "rejected", reason: `ошибка обработки: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` });
    }
  }

  const count = (r: RowResult["result"]) => report.filter((x) => x.result === r).length;
  const totals = { created: count("created"), updated: count("updated"), unchanged: count("unchanged"), rejected: count("rejected") };
  await db.importRun.update({ where: { id: run.id }, data: { ...totals, report: report as unknown as Prisma.InputJsonValue } });
  await audit({ userLogin: opts.userLogin, action: "import", entity: "import", entityId: run.id, summary: `Импорт «${opts.fileName}» (${source}): строк ${rows.length}, добавлено ${totals.created}, обновлено ${totals.updated}, без изменений ${totals.unchanged}, отклонено ${totals.rejected}` });
  return { importId: run.id, total: rows.length, ...totals, rows: report };
}
