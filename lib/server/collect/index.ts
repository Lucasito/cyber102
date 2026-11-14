import "server-only";
import { createHash } from "node:crypto";
import type { Source } from "@/generated/prisma/client";
import { aiConfigured, tokensCostRub, withAiUsage } from "../ai";
import { db } from "../db";
import { importRows, validateRows, type ImportReport, type ValidatedRow } from "../import";
import { log } from "../log";
import { ADAPTERS } from "./adapters";
import { extractEvent, extractEventList } from "./ai-extract";
import { cachedPage, htmlToText, type PageCache } from "./fetch";
import { enrichSourceEvents, enrichmentPass } from "./enrichment";
import { eventDetails } from "./details";
import { jsonLdEvents } from "./jsonld";
import { parseFeed } from "./rss";
import type { FeedItem } from "./rss";
import { contentHash, RECHECK_MS, shouldRecheck } from "./recheck";
import { applySourceVenue, prepareRows } from "./venue";

// Сборщик событий из внешних источников (ТЗ 6.5, уровень 4). Источник даёт строки импорта, дальше — общий
// импорт: нормализация, регион РБ, дедупликация, проверка ссылки. Доверие зависит от типа:
//  - универсальный формат и разметка schema.org — структурированные данные: с «автопубликацией» прошедшие
//    проверку сразу в афише, без неё — в модерацию;
//  - RSS + ИИ — поля извлекает модель, поэтому всегда модерация; каждая запись разбирается один раз (SourceItem).

export const SOURCE_KINDS = {
  universal_json: { label: "Универсальный формат — JSON", hint: "Лента по нашему формату (/docs/format): массив событий или { events: [...] }", sourceType: "API" },
  universal_rss: { label: "Универсальный формат — RSS", hint: "RSS 2.0 с полями afisha:dateStart, afisha:venue… (/docs/format)", sourceType: "RSS" },
  rss_ai: { label: "RSS-лента + разбор ИИ", hint: "Обычная лента сайта: карточки читает ИИ, всё — через модерацию", sourceType: "RSS" },
  html_ai: { label: "Страница афиши + разбор ИИ", hint: "Обычная страница афиши без ленты и разметки: события из текста извлекает ИИ, всё — через модерацию", sourceType: "PAGE" },
  jsonld: { label: "Страница с разметкой schema.org", hint: "Страница афиши с JSON-LD Event (как у «Афиши Уфы»)", sourceType: "PAGE" },
  custom: { label: "Индивидуальный парсер", hint: "Разбор HTML конкретного сайта — парсер пишет разработчик", sourceType: "PAGE" },
} as const;
export type SourceKind = keyof typeof SOURCE_KINDS;

type Row = Record<string, unknown>;
type Collected = {
  rows: Row[];
  rowGuid: (string | null)[]; // запись ленты для каждой строки (rss_ai), чтобы отметить её разобранной
  skipped: { guid: string; title: string; link: string; reason: string }[];
  feedItems: number;
  message?: string;
  checks?: Map<string, { title: string; link: string; contentHash: string; feedHash?: string; eventId?: string | null }>;
};

/** Строки событий из источника. dryRun у rss_ai — не больше 3 записей (разбор ИИ стоит денег). */
async function collect(source: Source, dryRun: boolean, pages: PageCache = new Map()): Promise<Collected> {
  const fetchText = (url: string, options?: Parameters<typeof cachedPage>[2]) => cachedPage(pages, url, options);
  const kind = source.kind as SourceKind;
  const withCity = (rows: Row[]) => rows.map((r) => (r.city || !source.city ? r : { ...r, city: source.city }));
  const plain = (rows: Row[], feedItems = rows.length): Collected => ({ rows: withCity(rows), rowGuid: rows.map(() => null), skipped: [], feedItems });

  switch (kind) {
    case "universal_json": {
      const { text } = await fetchText(source.url, { accept: "application/json" });
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("ответ — не JSON");
      }
      const d = data as { events?: unknown; items?: unknown };
      const list = Array.isArray(data) ? data : Array.isArray(d.events) ? d.events : Array.isArray(d.items) ? d.items : null;
      if (!list) throw new Error("ожидается массив событий или объект { events: [...] }");
      return plain(list.filter((x): x is Row => !!x && typeof x === "object"));
    }
    case "universal_rss": {
      const { text } = await fetchText(source.url, { accept: "application/rss+xml, application/xml" });
      const items = parseFeed(text);
      return plain(
        items.map((i) => ({ ...i.fields, title: i.fields.title ?? i.title, description: i.fields.description ?? htmlToText(i.description, 3000), sourceUrl: i.fields.sourceUrl ?? i.link, externalId: i.fields.externalId ?? i.guid })),
        items.length,
      );
    }
    case "jsonld": {
      const { text, finalUrl } = await fetchText(source.url, { accept: "text/html" });
      return plain(jsonLdEvents(text, finalUrl));
    }
    case "html_ai": {
      const { text: html, finalUrl } = await fetchText(source.url, { accept: "text/html" });
      // Разметка schema.org на странице точнее модели — если есть, ИИ не нужен
      const ld = jsonLdEvents(html, finalUrl);
      if (ld.length) return plain(ld);
      // Текст страницы со ссылками — кусками; кусок, который уже разбирали и он не изменился, ИИ не отправляем
      const chunks = splitChunks(htmlToText(html, 60_000, finalUrl), 4000);
      const guidOf = (c: string) => `chunk:${createHash("sha1").update(c).digest("hex").slice(0, 16)}`;
      const known = new Set(
        (await db.sourceItem.findMany({ where: { sourceId: source.id, status: { not: "error" }, guid: { in: chunks.map(guidOf) } }, select: { guid: true } })).map((x) => x.guid),
      );
      const fresh = chunks.filter((c) => !known.has(guidOf(c))).slice(0, dryRun ? 2 : 10);
      const out: Collected = { rows: [], rowGuid: [], skipped: [], feedItems: chunks.length };
      if (fresh.length && !(await aiConfigured())) return { ...out, message: "ИИ не подключён — страница будет разобрана после его подключения" };
      for (const [i, c] of fresh.entries()) {
        const guid = guidOf(c);
        try {
          // Учреждение — из названия источника без «— афиша»: им подписываются залы без названия
          const rows = await extractEventList(c, finalUrl, source.city, source.name.replace(/\s*[—-]\s*(афиша|анонсы).*$/i, "").trim());
          if (!rows.length) out.skipped.push({ guid, title: `фрагмент ${i + 1}`, link: finalUrl, reason: "мероприятий с датой нет" });
          for (const r of withCity(rows)) {
            out.rows.push(r);
            out.rowGuid.push(guid);
          }
        } catch (e) {
          out.skipped.push({ guid, title: `фрагмент ${i + 1}`, link: finalUrl, reason: `ошибка: ${e instanceof Error ? e.message : e}` });
        }
      }
      if (chunks.length && !fresh.length) out.message = "страница не изменилась с прошлого разбора";
      return out;
    }
    case "custom": {
      const adapter = source.adapter ? ADAPTERS[source.adapter] : undefined;
      if (!adapter) throw new Error(`индивидуальный парсер «${source.adapter ?? "—"}» не найден`);
      return plain(await adapter.run(source.url));
    }
    case "rss_ai": {
      const { text } = await fetchText(source.url, { accept: "application/rss+xml, application/xml" });
      const items = parseFeed(text);
      const known = await db.sourceItem.findMany({ where: { sourceId: source.id } });
      const byGuid = new Map(known.map((i) => [i.guid, i]));
      const upcoming = new Set((await db.event.findMany({ where: { id: { in: known.map((i) => i.eventId).filter((id): id is string => !!id) },
        OR: [{ startsAt: { gte: new Date() } }, { endsAt: { gte: new Date() } }], status: { not: "PAST" } }, select: { id: true } })).map((e) => e.id));
      const upcomingUrls = new Set((await db.eventSource.findMany({ where: { source: source.code, event: { status: { not: "PAST" },
        OR: [{ startsAt: { gte: new Date() } }, { endsAt: { gte: new Date() } }] } }, select: { url: true } })).map((s) => s.url));
      // Будущие события проверяем и после того, как они исчезли из короткой RSS-ленты.
      const present = new Set(items.map((i) => i.guid));
      const missing: FeedItem[] = known.filter((i) => !present.has(i.guid) && !i.guid.startsWith("page:") && !i.guid.startsWith("enrich:") && i.link && (upcomingUrls.has(i.link) || (i.eventId && upcoming.has(i.eventId))))
        .map((i) => ({ guid: i.guid, title: i.title ?? "", link: i.link!, description: "", pubDate: null, fields: {} }));
      const feedHashOf = (i: FeedItem) => present.has(i.guid) ? contentHash(i) : byGuid.get(i.guid)?.feedHash ?? contentHash(i);
      const candidates = [...items, ...missing].filter((i) => shouldRecheck(byGuid.get(i.guid), feedHashOf(i), upcomingUrls.has(i.link) || upcoming.has(byGuid.get(i.guid)?.eventId ?? "")));
      // Старые непроверенные события не вытесняются непрерывным потоком новых записей.
      candidates.sort((a, b) => (byGuid.get(a.guid)?.checkedAt?.getTime() ?? 0) - (byGuid.get(b.guid)?.checkedAt?.getTime() ?? 0));
      const fresh = candidates.slice(0, dryRun ? 3 : source.maxItems);
      const out: Collected = { rows: [], rowGuid: [], skipped: [], feedItems: items.length, checks: new Map() };
      const ai = await aiConfigured();
      for (const item of fresh) {
        try {
          const page = item.link ? await fetchText(item.link, { accept: "text/html" }) : null;
          const feedHash = feedHashOf(item);
          const ld = page ? jsonLdEvents(page.text, item.link) : [];
          const hash = contentHash([feedHash, page ? htmlToText(page.text, 60_000) : item.description, ld]);
          const old = byGuid.get(item.guid);
          const check = { title: item.title, link: item.link, contentHash: hash, feedHash, eventId: old?.eventId };
          if (old?.contentHash === hash) { out.checks!.set(item.guid, check); continue; }
          // Разметка schema.org на карточке точнее модели — берём её, ИИ не нужен
          let rows: Row[] = ld;
          if (!rows.length) {
            if (!ai) {
              out.message = "ИИ не подключён — карточки без разметки schema.org пропущены до его подключения";
              break;
            }
            const text = [item.title, htmlToText(item.description, 2000), page ? htmlToText(page.text, 6000) : ""].join("\n");
            const x = await extractEvent(text, item.link || source.url, source.city);
            if (!x.isEvent) {
              out.skipped.push({ guid: item.guid, title: item.title, link: item.link, reason: x.reason ?? "не мероприятие" });
              out.checks!.set(item.guid, check);
              continue;
            }
            rows = x.rows;
          }
          for (const r of withCity(rows)) {
            // Один сеанс: GUID переживает перенос. Несколько сеансов требуют отдельных идентификаторов.
            out.rows.push(rows.length === 1 ? { ...r, externalId: `rss:${item.guid}` } : r);
            out.rowGuid.push(item.guid);
          }
          out.checks!.set(item.guid, check);
        } catch (e) {
          out.skipped.push({ guid: item.guid, title: item.title, link: item.link, reason: `ошибка: ${e instanceof Error ? e.message : e}` });
        }
      }
      if (items.length && !fresh.length) out.message = "новых и изменённых записей нет; будущие события проверены недавно";
      return out;
    }
    default:
      throw new Error(`неизвестный тип источника «${source.kind}»`);
  }
}

/** Изменение детальной страницы может не отражаться в списке афиши. Проверяем до пяти старейших страниц за сбор. */
async function recheckPages(source: Source, got: Collected, pages: PageCache) {
  if (source.kind === "rss_ai") return;
  const links = await db.eventSource.findMany({ where: { source: source.code, event: { status: { not: "PAST" },
    OR: [{ startsAt: { gte: new Date() } }, { endsAt: { gte: new Date() } }] } }, orderBy: { fetchedAt: "asc" }, include: { event: { select: { title: true, startsAt: true } } } });
  const urls = [...new Set(links.map((s) => s.url))].filter((u) => u !== source.url && !got.rows.some((r) => r.sourceUrl === u));
  const prior = new Map((await db.sourceItem.findMany({ where: { sourceId: source.id, guid: { in: urls.map((url) => `page:${contentHash(url)}`) } } })).map((i) => [i.guid, i]));
  urls.sort((a, b) => (prior.get(`page:${contentHash(a)}`)?.checkedAt?.getTime() ?? 0) - (prior.get(`page:${contentHash(b)}`)?.checkedAt?.getTime() ?? 0));
  const ai = await aiConfigured();
  let checked = 0;
  for (const url of urls) {
    const guid = `page:${contentHash(url)}`;
    const known = prior.get(guid);
    if (known?.checkedAt && Date.now() - known.checkedAt.getTime() < RECHECK_MS) continue;
    if (checked++ >= 5) break;
    try {
      const page = await cachedPage(pages, url);
      const text = htmlToText(page.text, 60_000);
      const structured = jsonLdEvents(page.text, url);
      const hash = contentHash([text, structured]);
      got.checks ??= new Map();
      const check = { title: links.find((s) => s.url === url)?.event.title ?? "", link: url, contentHash: hash };
      if (known?.contentHash !== hash) {
        let rows = structured;
        if (!rows.length && ai) rows = (await extractEvent(text.slice(0, 12000), url, source.city)).rows;
        if (!rows.length) {
          const target = links.find(s => s.url === url)?.event;
          if (target && eventDetails(page.text, target).matched) { got.checks.set(guid, check); continue; }
          got.skipped.push({ guid, title: check.title, link: url, reason: "ошибка: страница события не содержит распознаваемого расписания — проверьте вручную" }); continue;
        }
        for (const row of rows) { got.rows.push({ ...row, sourceUrl: url, city: row.city ?? source.city }); got.rowGuid.push(guid); }
      }
      got.checks.set(guid, check);
    } catch (e) {
      got.skipped.push({ guid, title: "Проверка события", link: url, reason: `ошибка: ${e instanceof Error ? e.message : e}` });
    }
  }
}

/** Текст → куски до size символов по границам строк (для разбора ИИ). */
function splitChunks(text: string, size: number) {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > size) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + line.slice(0, size);
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export type PreviewResult = { feedItems: number; rows: ValidatedRow[]; skipped: Collected["skipped"]; message?: string; tokens: number; costRub: number };
export type RunResult = { feedItems: number; report: ImportReport | null; skipped: number; message: string; tokens: number; costRub: number };

/** Проверка источника без записи в базу: что удалось прочитать и как это пройдёт импорт. */
export async function previewSource(sourceId: string): Promise<PreviewResult> {
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
  const { result, calls } = await withAiUsage(() => collect(source, true));
  result.rows = prepareRows(source, result.rows);
  const tokens = calls.reduce((n, c) => n + c.tokens, 0);
  return { feedItems: result.feedItems, rows: await validateRows(result.rows), skipped: result.skipped, message: result.message, tokens, costRub: await tokensCostRub(tokens) };
}

/** Собрать источник: импорт строк, отметка разобранных записей, итог в карточке источника. */
export async function runSource(sourceId: string, userLogin: string | null): Promise<RunResult> {
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
  const kind = source.kind as SourceKind;
  try {
    const pages: PageCache = new Map(), enrichment = enrichmentPass();
    const { result: got, calls } = await withAiUsage(async () => {
      const got = await collect(source, false, pages);
      await enrichSourceEvents(source, pages, enrichment, userLogin);
      await recheckPages(source, got, pages);
      return got;
    });
    got.rows = prepareRows(source, got.rows);
    const tokens = calls.reduce((n, c) => n + c.tokens, 0);
    const costRub = await tokensCostRub(tokens);
    const review =
      kind === "rss_ai"
        ? "разобрано ИИ из ленты — сверить с источником"
        : kind === "html_ai"
          ? "разобрано ИИ со страницы афиши — сверить с источником"
          : !source.autoPublish
            ? `источник «${source.name}» без автопубликации — проверить`
            : undefined;
    const report = got.rows.length
      ? await importRows(got.rows, {
          fileName: `Сбор: ${source.name}`,
          source: source.code,
          sourceType: SOURCE_KINDS[kind]?.sourceType ?? "PAGE",
          userLogin,
          verifyLinks: true,
          review,
        })
      : null;
    // Новая карточка тоже дополняется в этом обходе; повторной загрузки страницы нет.
    await enrichSourceEvents(source, pages, enrichment, userLogin, report?.rows.filter(r => r.result === "created" && r.eventId).map(r => r.eventId!) ?? []);
    // Записи ленты и куски страницы: разобранные больше не отправляем модели
    if (kind === "rss_ai" || kind === "html_ai" || got.checks?.size || got.skipped.length) {
      const byGuid = new Map<string, { status: string; reason?: string; eventId?: string }>();
      report?.rows.forEach((r, i) => {
        const guid = got.rowGuid[i];
        if (!guid) return;
        const prev = byGuid.get(guid);
        const ok = r.result !== "rejected";
        if (!prev || (ok && prev.status !== "imported")) byGuid.set(guid, { status: ok ? "imported" : "rejected", reason: r.reason, eventId: r.eventId });
      });
      for (const s of got.skipped) byGuid.set(s.guid, { status: s.reason.startsWith("ошибка") ? "error" : "rejected", reason: s.reason });
      for (const [guid, check] of got.checks ?? []) if (!byGuid.has(guid)) byGuid.set(guid, { status: "imported", eventId: check.eventId ?? undefined });
      for (const [guid, v] of byGuid) {
        // Запоминаем попытку, но не хеш: сбой сети не должен означать, что содержимое уже обработано.
        if (v.status === "error") {
          const skipped = got.skipped.find((s) => s.guid === guid);
          await db.sourceItem.upsert({ where: { sourceId_guid: { sourceId: source.id, guid } },
            create: { sourceId: source.id, guid, status: "error", reason: v.reason?.slice(0, 500), title: skipped?.title.slice(0, 300), link: skipped?.link, checkedAt: new Date() },
            update: { status: "error", reason: v.reason?.slice(0, 500), checkedAt: new Date() },
          });
          continue;
        }
        const check = got.checks?.get(guid);
        const meta = check ? { title: check.title.slice(0, 300), link: check.link, contentHash: check.contentHash, feedHash: check.feedHash, checkedAt: new Date() } : {};
        await db.sourceItem.upsert({
          where: { sourceId_guid: { sourceId: source.id, guid } },
          create: { sourceId: source.id, guid, status: v.status, reason: v.reason?.slice(0, 500), eventId: v.eventId, ...meta },
          update: { status: v.status, reason: v.reason?.slice(0, 500), eventId: v.eventId, ...meta },
        });
        if (check?.link) await db.eventSource.updateMany({ where: { source: source.code, url: check.link }, data: { fetchedAt: new Date() } });
      }
    }
    // Площадка источника: новые площадки-залы получают адрес и точные координаты
    await applySourceVenue(source).catch(() => 0);
    const parts = report
      ? [`добавлено ${report.created}`, `обновлено ${report.updated}`, `без изменений ${report.unchanged}`, `отклонено ${report.rejected}`]
      : ["событий не найдено"];
    if (got.skipped.length) parts.push(`пропущено записей ленты ${got.skipped.length}`);
    if (enrichment.urls.size) parts.push(`дополнение: страниц ${enrichment.urls.size}, полей ${enrichment.fields}, площадок ${enrichment.venues}${enrichment.errors ? `, ошибок ${enrichment.errors}` : ""}`);
    if (tokens) parts.push(`ИИ: ${tokens} ток. (~${costRub.toFixed(2)} ₽)`);
    const message = [got.message, parts.join(", ")].filter(Boolean).join(". ");
    await db.source.update({ where: { id: source.id }, data: { lastRunAt: new Date(), lastStatus: "ok", lastMessage: message.slice(0, 500) } });
    log("info", "source_collected", { source: source.code, created: report?.created ?? 0, rejected: report?.rejected ?? 0, tokens });
    return { feedItems: got.feedItems, report, skipped: got.skipped.length, message, tokens, costRub };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.source.update({ where: { id: source.id }, data: { lastRunAt: new Date(), lastStatus: "error", lastMessage: message.slice(0, 500) } });
    log("warn", "source_failed", { source: source.code, error: message });
    throw e;
  }
}

/** Источники, которым пора собираться (по интервалу). Фоновая задача — по одному за раз. */
/**
 * Пора ли собирать: со временем сбора — раз в день, когда наступило это время по Уфе, а сегодня после него ещё не
 * собирали; без него — раз в intervalHours после прошлого сбора.
 */
export function isDue(s: Pick<Source, "lastRunAt" | "intervalHours" | "collectAt">, now = new Date()) {
  if (s.collectAt && /^\d{2}:\d{2}$/.test(s.collectAt)) {
    const today = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Yekaterinburg" });
    const at = new Date(`${today}T${s.collectAt}:00+05:00`); // Уфа — UTC+5 круглый год
    return now >= at && (!s.lastRunAt || s.lastRunAt < at);
  }
  return !s.lastRunAt || now.getTime() - s.lastRunAt.getTime() >= s.intervalHours * 3_600_000;
}

export async function collectDueSources(limit = 2) {
  const sources = await db.source.findMany({ where: { enabled: true }, orderBy: { lastRunAt: { sort: "asc", nulls: "first" } } });
  const due = sources.filter((s) => isDue(s)).slice(0, limit);
  for (const s of due) await runSource(s.id, "сборщик").catch(() => undefined);
  return due.length;
}
