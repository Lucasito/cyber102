import "server-only";
import { createHash } from "node:crypto";
import type { EventStatus, Prisma, Publication, SourceType } from "@/generated/prisma/client";
import { audit, diffFields } from "./audit";
import { db } from "./db";
import { categorySlug, dedupKey, inBashkortostan, normalizeCity, normalizeTitle, parseAge, parseBool, parseDate, parseDuration, parsePrice, parseTags, parseUrl, RB_SETTLEMENTS } from "./normalize";

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
};

function normalizeRow(r: Record<string, unknown>, ctx: { cities: string[]; categories: string[]; now: Date }): Normalized | { error: string } {
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
  if (!inBashkortostan(city)) issues.push(`населённого пункта «${city}» нет в справочнике РБ — проверьте, что событие в Башкортостане`);

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
    tags: parseTags(r.tags),
    language: typeof r.language === "string" ? r.language.toLowerCase().slice(0, 40) : null,
    orgUrl: parseUrl(r.orgUrl),
    ticketUrl: parseUrl(r.ticketUrl),
    sourceUrl,
    imageUrl: parseUrl(r.imageUrl),
    status: statusHit && statusHit !== "DRAFT" ? statusHit : "SCHEDULED",
    draft: statusHit === "DRAFT",
    pushkinCard: parseBool(r.pushkin) ?? false,
    issues,
  };
}

/** Канонический JSON (ключи по алфавиту) — одинаковые строки дают одинаковый хеш, порядок колонок не важен. */
function hashRow(r: Record<string, unknown>) {
  const sorted = Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/** Площадка по городу и нормализованному названию; нет — создаётся. Пустые адрес и координаты дополняются. */
async function venueFor(tx: Prisma.TransactionClient, n: Normalized) {
  const inCity = await tx.venue.findMany({ where: { city: n.city } });
  const found = inCity.find((v) => normalizeTitle(v.name) === normalizeTitle(n.venue));
  if (!found) return tx.venue.create({ data: { name: n.venue, city: n.city, address: n.address, lat: n.lat, lon: n.lon } });
  const fill = { ...(!found.address && n.address ? { address: n.address } : {}), ...(found.lat == null && n.lat != null ? { lat: n.lat, lon: n.lon } : {}) };
  return Object.keys(fill).length ? tx.venue.update({ where: { id: found.id }, data: fill }) : found;
}

const EVENT_FIELDS = ["title", "description", "startsAt", "endsAt", "durationMin", "status", "priceMin", "priceMax", "ageLimit", "categoryId", "venueId", "tags", "language", "orgUrl", "ticketUrl", "imageUrl", "pushkinCard"] as const;

/**
 * Импорт строк. source — код источника (например, «minkult» или имя файла), sourceType — IMPORT для файлов,
 * RSS/API/PAGE — для сборщиков. Возвращает отчёт; итог и строки отчёта сохраняются в ImportRun.
 */
export async function importRows(rows: Record<string, unknown>[], opts: { fileName: string; source: string; sourceType?: SourceType; userLogin: string | null }): Promise<ImportReport> {
  if (rows.length > MAX_ROWS) throw new Error(`Слишком много строк: ${rows.length}, не больше ${MAX_ROWS} за раз`);
  const sourceType = opts.sourceType ?? "IMPORT";
  const source = opts.source.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 60) || "import";
  const [venues, categories] = await Promise.all([db.venue.findMany({ distinct: ["city"], select: { city: true } }), db.category.findMany({ select: { id: true, slug: true } })]);
  // Справочник для исправления опечаток: населённые пункты РБ и города уже известных площадок
  const ctx = { cities: [...new Set([...RB_SETTLEMENTS, ...venues.map((v) => v.city)])], categories: categories.map((c) => c.slug), now: new Date() };
  const categoryId = new Map(categories.map((c) => [c.slug, c.id]));

  const run = await db.importRun.create({ data: { fileName: opts.fileName.slice(0, 200), source, total: rows.length, report: [], userLogin: opts.userLogin } });
  const report: RowResult[] = [];
  const seenInFile = new Map<string, number>();

  for (const [i, raw] of rows.entries()) {
    const rowNo = i + 2; // как в таблице: строка 1 — заголовок
    const hash = hashRow(raw);
    try {
      // Та же строка уже загружалась и стала событием — ничего не делаем (идемпотентность)
      const known = await db.rawRecord.findUnique({ where: { source_hash: { source, hash } } });
      if (known?.eventId && (await db.event.count({ where: { id: known.eventId } }))) {
        report.push({ row: rowNo, result: "unchanged", eventId: known.eventId, reason: "строка уже загружалась" });
        continue;
      }
      const mapped = mapRow(raw);
      const n = normalizeRow(mapped, ctx);
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
        const venue = await venueFor(tx, n);
        // Своё событие источника: по externalId (переживает перенос даты) или по ключу дедупликации
        const bySource = n.externalId ? await tx.eventSource.findFirst({ where: { source, externalId: n.externalId }, select: { eventId: true } }) : null;
        const existing = bySource
          ? await tx.event.findUnique({ where: { id: bySource.eventId } })
          : await tx.event.findFirst({ where: { OR: [{ dedupKey: key }, { normalizedTitle: n.normalizedTitle, venueId: venue.id, startsAt: n.startsAt }] } });

        const rescheduled = existing && existing.startsAt.getTime() !== n.startsAt.getTime() && bySource;
        const data = {
          title: n.title,
          normalizedTitle: n.normalizedTitle,
          description: n.description ?? existing?.description ?? null,
          startsAt: n.startsAt,
          // Пустое значение из источника не затирает уже известное (другой источник мог быть полнее)
          endsAt: n.endsAt ?? existing?.endsAt ?? null,
          durationMin: n.durationMin ?? existing?.durationMin ?? null,
          status: rescheduled && n.status === "SCHEDULED" ? ("RESCHEDULED" as const) : n.status,
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
        if (!existing) {
          const publication: Publication = n.draft || n.issues.length ? "DRAFT" : "PUBLISHED";
          const created = await tx.event.create({ data: { ...data, dedupKey: key, publication, verifiedAt: new Date(), confidence: n.issues.length ? 0.7 : 1, ...review } });
          eventId = created.id;
          outcome = "created";
          await audit({ userLogin: opts.userLogin, action: "import", entity: "event", entityId: eventId, summary: `Импорт «${opts.fileName}», строка ${rowNo}: создано «${n.title}»${n.issues.length ? ` — в модерацию: ${n.issues.join("; ")}` : ""}` }, tx);
        } else {
          eventId = existing.id;
          const diff = diffFields(existing as Record<string, unknown>, data, [...EVENT_FIELDS]);
          if (diff) {
            await tx.event.update({
              where: { id: existing.id },
              data: { ...data, ...(rescheduled ? { originalStartsAt: existing.originalStartsAt ?? existing.startsAt } : {}), verifiedAt: new Date() },
            });
            outcome = "updated";
            await audit({ userLogin: opts.userLogin, action: "import", entity: "event", entityId: eventId, summary: `Импорт «${opts.fileName}», строка ${rowNo}: обновлено «${n.title}»`, diff }, tx);
          } else outcome = "unchanged";
        }
        // Источник события. Одна ссылка может относиться к нескольким сеансам (страница постановки) — связь своя у каждого
        const link = await tx.eventSource.findFirst({ where: { eventId, source, url: n.sourceUrl } });
        if (!link) await tx.eventSource.create({ data: { eventId, source, sourceType, url: n.sourceUrl, externalId: n.externalId, sourceHash: hash } });
        else await tx.eventSource.update({ where: { id: link.id }, data: { sourceHash: hash, externalId: n.externalId ?? link.externalId, fetchedAt: new Date() } });
        await tx.rawRecord.upsert({
          where: { source_hash: { source, hash } },
          create: { source, sourceType, hash, payload: raw as Prisma.InputJsonValue, importId: run.id, eventId },
          update: { importId: run.id, eventId, error: null },
        });
        return { eventId, outcome };
      });

      const dup = seenInFile.get(key);
      seenInFile.set(key, rowNo);
      report.push({
        row: rowNo,
        result: result.outcome,
        eventId: result.eventId,
        title: n.title,
        reason: dup ? `то же событие, что в строке ${dup} — объединено` : result.outcome === "unchanged" ? "такое событие уже есть, данные совпадают" : n.issues.length ? `в модерацию: ${n.issues.join("; ")}` : undefined,
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
