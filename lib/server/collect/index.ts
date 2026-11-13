import "server-only";
import type { Source } from "@/generated/prisma/client";
import { aiConfigured, tokensCostRub, withAiUsage } from "../ai";
import { db } from "../db";
import { importRows, validateRows, type ImportReport, type ValidatedRow } from "../import";
import { log } from "../log";
import { ADAPTERS } from "./adapters";
import { extractEvent } from "./ai-extract";
import { fetchText, htmlToText } from "./fetch";
import { jsonLdEvents } from "./jsonld";
import { parseFeed } from "./rss";

// Сборщик событий из внешних источников (ТЗ 6.5, уровень 4). Источник даёт строки импорта, дальше — общий
// импорт: нормализация, регион РБ, дедупликация, проверка ссылки. Доверие зависит от типа:
//  - универсальный формат и разметка schema.org — структурированные данные: с «автопубликацией» прошедшие
//    проверку сразу в афише, без неё — в модерацию;
//  - RSS + ИИ — поля извлекает модель, поэтому всегда модерация; каждая запись разбирается один раз (SourceItem).

export const SOURCE_KINDS = {
  universal_json: { label: "Универсальный формат — JSON", hint: "Лента по нашему формату (/docs/format): массив событий или { events: [...] }", sourceType: "API" },
  universal_rss: { label: "Универсальный формат — RSS", hint: "RSS 2.0 с полями afisha:dateStart, afisha:venue… (/docs/format)", sourceType: "RSS" },
  rss_ai: { label: "RSS-лента + разбор ИИ", hint: "Обычная лента сайта: карточки читает ИИ, всё — через модерацию", sourceType: "RSS" },
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
};

/** Строки событий из источника. dryRun у rss_ai — не больше 3 записей (разбор ИИ стоит денег). */
async function collect(source: Source, dryRun: boolean): Promise<Collected> {
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
    case "custom": {
      const adapter = source.adapter ? ADAPTERS[source.adapter] : undefined;
      if (!adapter) throw new Error(`индивидуальный парсер «${source.adapter ?? "—"}» не найден`);
      return plain(await adapter.run(source.url));
    }
    case "rss_ai": {
      const { text } = await fetchText(source.url, { accept: "application/rss+xml, application/xml" });
      const items = parseFeed(text);
      const known = new Set(
        (await db.sourceItem.findMany({ where: { sourceId: source.id, guid: { in: items.map((i) => i.guid) } }, select: { guid: true } })).map((x) => x.guid),
      );
      const fresh = items.filter((i) => !known.has(i.guid)).slice(0, dryRun ? 3 : source.maxItems);
      const out: Collected = { rows: [], rowGuid: [], skipped: [], feedItems: items.length };
      const ai = await aiConfigured();
      for (const item of fresh) {
        try {
          const page = item.link ? await fetchText(item.link, { accept: "text/html" }).catch(() => null) : null;
          // Разметка schema.org на карточке точнее модели — берём её, ИИ не нужен
          const ld = page ? jsonLdEvents(page.text, item.link) : [];
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
              continue;
            }
            rows = x.rows;
          }
          for (const r of withCity(rows)) {
            out.rows.push(r);
            out.rowGuid.push(item.guid);
          }
        } catch (e) {
          out.skipped.push({ guid: item.guid, title: item.title, link: item.link, reason: `ошибка: ${e instanceof Error ? e.message : e}` });
        }
      }
      if (items.length && !fresh.length) out.message = "новых записей в ленте нет";
      return out;
    }
    default:
      throw new Error(`неизвестный тип источника «${source.kind}»`);
  }
}

export type PreviewResult = { feedItems: number; rows: ValidatedRow[]; skipped: Collected["skipped"]; message?: string; tokens: number; costRub: number };
export type RunResult = { feedItems: number; report: ImportReport | null; skipped: number; message: string; tokens: number; costRub: number };

/** Проверка источника без записи в базу: что удалось прочитать и как это пройдёт импорт. */
export async function previewSource(sourceId: string): Promise<PreviewResult> {
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
  const { result, calls } = await withAiUsage(() => collect(source, true));
  const tokens = calls.reduce((n, c) => n + c.tokens, 0);
  return { feedItems: result.feedItems, rows: await validateRows(result.rows), skipped: result.skipped, message: result.message, tokens, costRub: await tokensCostRub(tokens) };
}

/** Собрать источник: импорт строк, отметка разобранных записей, итог в карточке источника. */
export async function runSource(sourceId: string, userLogin: string | null): Promise<RunResult> {
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
  const kind = source.kind as SourceKind;
  try {
    const { result: got, calls } = await withAiUsage(() => collect(source, false));
    const tokens = calls.reduce((n, c) => n + c.tokens, 0);
    const costRub = await tokensCostRub(tokens);
    const review =
      kind === "rss_ai" ? "разобрано ИИ из ленты — сверить с источником" : !source.autoPublish ? `источник «${source.name}» без автопубликации — проверить` : undefined;
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
    // Записи ленты: разобранные больше не отправляем модели
    if (kind === "rss_ai") {
      const byGuid = new Map<string, { status: string; reason?: string; eventId?: string }>();
      report?.rows.forEach((r, i) => {
        const guid = got.rowGuid[i];
        if (!guid) return;
        const prev = byGuid.get(guid);
        const ok = r.result !== "rejected";
        if (!prev || (ok && prev.status !== "imported")) byGuid.set(guid, { status: ok ? "imported" : "rejected", reason: r.reason, eventId: r.eventId });
      });
      for (const s of got.skipped) byGuid.set(s.guid, { status: s.reason.startsWith("ошибка") ? "error" : "rejected", reason: s.reason });
      for (const [guid, v] of byGuid) {
        // Ошибку загрузки страницы попробуем в следующий раз — не запоминаем
        if (v.status === "error") continue;
        await db.sourceItem.upsert({
          where: { sourceId_guid: { sourceId: source.id, guid } },
          create: { sourceId: source.id, guid, status: v.status, reason: v.reason?.slice(0, 500), eventId: v.eventId },
          update: { status: v.status, reason: v.reason?.slice(0, 500), eventId: v.eventId },
        });
      }
    }
    const parts = report
      ? [`добавлено ${report.created}`, `обновлено ${report.updated}`, `без изменений ${report.unchanged}`, `отклонено ${report.rejected}`]
      : ["событий не найдено"];
    if (got.skipped.length) parts.push(`пропущено записей ленты ${got.skipped.length}`);
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
export async function collectDueSources(limit = 2) {
  const now = Date.now();
  const sources = await db.source.findMany({ where: { enabled: true }, orderBy: { lastRunAt: { sort: "asc", nulls: "first" } } });
  const due = sources.filter((s) => !s.lastRunAt || now - s.lastRunAt.getTime() >= s.intervalHours * 3_600_000).slice(0, limit);
  for (const s of due) await runSource(s.id, "сборщик").catch(() => undefined);
  return due.length;
}
