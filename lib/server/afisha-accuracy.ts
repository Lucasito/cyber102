import "server-only";
import { db } from "./db";
import { TZ } from "./events";
import { fetchText, htmlToText } from "./collect/fetch";

// Точность самой афиши (ТЗ 9.2, метрики 10–11): опубликованные предстоящие карточки сверяются с их источником —
// страница источника загружается, и на ней ищутся название, дата, время и цена карточки. Отдельно — доля дублей
// и реальные ошибки импорта за неделю по категориям: неверный город, варианты названий здания, конфликт
// источников, изменение даты. Автоматическая сверка — первичный отбор: несовпадения перечислены поимённо,
// чтобы человек проверил именно их (ТЗ: «точность на 50 проверенных вручную карточках»).

/** Последний отчёт в таблице Setting (не раздел настроек — только результат проверки из «Качества»). */
export const ACCURACY_KEY = "report:afisha-accuracy";

export type CardCheck = {
  id: string;
  title: string;
  source: string;
  url: string;
  startsAt: string;
  result: "ok" | "mismatch" | "unverified";
  problems: string[]; // что не нашлось на странице источника
  warnings: string[]; // не влияет на точность: город, признаки отмены
};

export type AccuracyReport = {
  at: string;
  sample: number;
  checked: number; // загружено и сверено
  accurate: number;
  unverified: number; // страница источника не загрузилась
  cards: CardCheck[];
  cancelledShown: CardCheck[]; // на странице «отменено/перенесено», в афише — как обычное
  duplicates: { events: number; extra: number; share: number; examples: { title: string; startsAt: string; venue: string; count: number }[] };
  importErrors: { days: number; rows: number; rejected: number; byCategory: Record<string, number>; examples: Record<string, string[]> };
  changes: { pending: number; byCategory: Record<string, number> };
  rescheduled: number;
  venueAliases: number;
};

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[«»"'“”„()[\]{}.,:;!?–—-]/g, " ").replace(/\s+/g, " ").trim();
const local = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute };
};

/** Название: не меньше 70 % значимых слов (от 3 букв) есть на странице. */
export function titleOnPage(title: string, page: string) {
  const words = norm(title).split(" ").filter((w) => w.length >= 3);
  if (!words.length) return page.includes(norm(title));
  const found = words.filter((w) => page.includes(w)).length;
  return found / words.length >= 0.7;
}

/** Дата карточки в любом из принятых на сайтах видов: 14.11, 14 ноября, 2026-11-14, 2026/11/14. */
export function dateOnPage(d: Date, page: string, raw: string) {
  const { y, m, d: day } = local(d);
  const dd = String(Number(day));
  const variants = [`${day}.${m}`, `${dd}.${m}`, `${dd} ${MONTHS[Number(m) - 1]}`, `${y}-${m}-${day}`, `${y}/${m}/${day}`, `${day}/${m}/${y}`];
  return variants.some((v) => page.includes(v) || raw.includes(v));
}

/** Время: 19:00 или 19.00. */
export function timeOnPage(d: Date, page: string, raw: string) {
  const { hh, mm } = local(d);
  const h = String(Number(hh));
  return [`${hh}:${mm}`, `${h}:${mm}`, `${hh}.${mm}`, `${h}.${mm}`].some((v) => page.includes(v) || raw.includes(`>${v}<`) || raw.includes(` ${v}`));
}

/** Цена: число с пробелом-разделителем тысяч или без. */
export function priceOnPage(price: number, page: string) {
  const plain = String(price), spaced = price.toLocaleString("ru-RU").replace(/\s/g, " ");
  const text = page.replace(/ | /g, " ");
  return new RegExp(`(^|\\D)(${plain}|${spaced.replace(/ /g, "\\s?")})(\\D|$)`).test(text);
}

const CANCEL_RE = /(мероприяти[ея]|спектакл[ья]|концерт|показ|сеанс)[^.]{0,40}(отмен[её]н|перенес[её]н)|отмена\s+(мероприятия|спектакля|концерта)/i;

/** Сверить одну карточку со страницей источника. */
export function checkCard(e: { title: string; startsAt: Date; endsAt: Date | null; priceMin: number | null; city: string }, html: string): Pick<CardCheck, "problems" | "warnings"> {
  const text = norm(htmlToText(html, 400_000));
  const raw = html.toLowerCase();
  const problems: string[] = [], warnings: string[] = [];
  if (!titleOnPage(e.title, text)) problems.push("название");
  const multiDay = e.endsAt && e.endsAt.getTime() - e.startsAt.getTime() > 12 * 3_600_000;
  // Выставки и сезонные события: дата начала может быть давно; достаточно даты начала или окончания
  if (!dateOnPage(e.startsAt, text, raw) && !(multiDay && e.endsAt && dateOnPage(e.endsAt, text, raw))) problems.push("дата");
  const { hh, mm } = local(e.startsAt);
  if (!multiDay && `${hh}:${mm}` !== "00:00" && !timeOnPage(e.startsAt, text, raw)) problems.push("время");
  if (e.priceMin != null && e.priceMin > 0 && !priceOnPage(e.priceMin, text)) problems.push("цена");
  if (e.city && !text.includes(norm(e.city))) warnings.push("город не упомянут на странице");
  if (CANCEL_RE.test(text)) warnings.push("на странице есть «отменено/перенесено»");
  return { problems, warnings };
}

/** Случайная выборка по источникам поровну, чтобы большой источник (кино) не заслонил остальные. */
function stratified<T extends { source: string }>(items: T[], n: number): T[] {
  const bySource = new Map<string, T[]>();
  for (const it of items.sort(() => Math.random() - 0.5)) bySource.set(it.source, [...(bySource.get(it.source) ?? []), it]);
  const out: T[] = [];
  while (out.length < n && [...bySource.values()].some((l) => l.length)) {
    for (const list of bySource.values()) if (list.length && out.length < n) out.push(list.shift()!);
  }
  return out;
}

export function categorizeImportError(reason: string): string {
  if (/вне Башкортостана|регион|город/i.test(reason)) return "неверный город или регион";
  if (/дата|прошло|окончание раньше/i.test(reason)) return "дата";
  if (/ссылк/i.test(reason)) return "ссылка на источник";
  if (/обязательных полей|название/i.test(reason)) return "неполная запись";
  if (/дубль/i.test(reason)) return "дубль";
  return "другое";
}

export function categorizeChange(after: unknown): string {
  const keys = Object.keys((after ?? {}) as object);
  if (keys.some((k) => ["startsAt", "endsAt"].includes(k))) return "изменение даты";
  if (keys.some((k) => ["status"].includes(k))) return "отмена или статус";
  if (keys.some((k) => ["venueId", "address", "city", "lat", "lon", "name"].includes(k))) return "место: адрес, город, площадка";
  return "конфликт сведений (цена, возраст, описание)";
}

export async function measureAfishaAccuracy({ sample = 50, days = 7 } = {}): Promise<AccuracyReport> {
  const now = new Date();
  const published = await db.event.findMany({
    where: { publication: "PUBLISHED", status: { notIn: ["PAST", "CANCELLED"] }, OR: [{ startsAt: { gte: now } }, { endsAt: { gte: now } }] },
    select: { id: true, title: true, normalizedTitle: true, startsAt: true, endsAt: true, priceMin: true, venueId: true, venue: { select: { name: true, city: true, buildingId: true } }, sources: { select: { source: true, url: true } } },
  });

  // Метрика 10: сверка с источником
  const candidates = published.flatMap((e) => {
    const s = e.sources.find((x) => x.source !== "demo" && /^https?:\/\//.test(x.url));
    return s ? [{ e, source: s.source, url: s.url }] : [];
  });
  const pages = new Map<string, Promise<string>>();
  const cards: CardCheck[] = [];
  for (const { e, source, url } of stratified(candidates, sample)) {
    const card: CardCheck = { id: e.id, title: e.title, source, url, startsAt: e.startsAt.toISOString(), result: "unverified", problems: [], warnings: [] };
    try {
      if (!pages.has(url)) pages.set(url, fetchText(url, { accept: "text/html", cookies: true }).then((r) => r.text));
      const html = await pages.get(url)!;
      Object.assign(card, checkCard({ ...e, city: e.venue?.city ?? "" }, html));
      card.result = card.problems.length ? "mismatch" : "ok";
    } catch (err) {
      card.warnings.push(`страница не загрузилась: ${err instanceof Error ? err.message : err}`);
    }
    cards.push(card);
  }
  const checked = cards.filter((c) => c.result !== "unverified");

  // Дубли: одно название, одно начало, одно здание (залы считаются зданием)
  const groups = new Map<string, typeof published>();
  for (const e of published) {
    const key = `${e.normalizedTitle}|${e.startsAt.toISOString()}|${e.venue?.buildingId ?? e.venueId}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  const extra = dupGroups.reduce((n, g) => n + g.length - 1, 0);

  // Реальные ошибки импорта за days дней
  const since = new Date(now.getTime() - days * 86_400_000);
  const runs = await db.importRun.findMany({ where: { createdAt: { gte: since } }, select: { report: true, total: true, rejected: true } });
  const byCategory: Record<string, number> = {}, examples: Record<string, string[]> = {};
  for (const run of runs) {
    for (const r of (Array.isArray(run.report) ? run.report : []) as { result?: string; reason?: string; title?: string }[]) {
      if (r.result !== "rejected" || !r.reason) continue;
      const cat = categorizeImportError(r.reason);
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      const ex = `${r.title ? `«${r.title}»: ` : ""}${r.reason}`.slice(0, 160);
      if ((examples[cat] ??= []).length < 3 && !examples[cat].includes(ex)) examples[cat].push(ex);
    }
  }
  const changes = await db.dataChange.findMany({ where: { createdAt: { gte: since } }, select: { after: true, status: true } });
  const changeCats: Record<string, number> = {};
  for (const c of changes) changeCats[categorizeChange(c.after)] = (changeCats[categorizeChange(c.after)] ?? 0) + 1;

  return {
    at: now.toISOString(),
    sample,
    checked: checked.length,
    accurate: checked.filter((c) => c.result === "ok").length,
    unverified: cards.length - checked.length,
    cards,
    cancelledShown: checked.filter((c) => c.warnings.some((w) => w.includes("отменено"))),
    duplicates: {
      events: published.length,
      extra,
      share: published.length ? extra / published.length : 0,
      examples: dupGroups.slice(0, 5).map((g) => ({ title: g[0].title, startsAt: g[0].startsAt.toISOString(), venue: g[0].venue?.name ?? "", count: g.length })),
    },
    importErrors: { days, rows: runs.reduce((n, r) => n + r.total, 0), rejected: runs.reduce((n, r) => n + r.rejected, 0), byCategory, examples },
    changes: { pending: changes.filter((c) => c.status === "pending").length, byCategory: changeCats },
    rescheduled: await db.event.count({ where: { status: "RESCHEDULED", updatedAt: { gte: since } } }),
    venueAliases: await db.venueAlias.count(),
  };
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10} %` : "—");
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Отчёт в Markdown: eval/afisha-report.md и страница «Качество» в админке. */
export function accuracyMarkdown(r: AccuracyReport): string {
  const acc = r.checked ? r.accurate / r.checked : 0;
  const lines = [
    "# Точность афиши",
    "",
    `Сформирован ${when(r.at)} (Уфа) — \`npm run eval:afisha\` или кнопка в «Качестве». Не редактировать вручную.`,
    "",
    "| Метрика (ТЗ 9.2) | Значение | Порог | |",
    "|---|---|---|---|",
    `| 10. Точность карточек (сверка с источником) | ${pct(r.accurate, r.checked)} (${r.accurate}/${r.checked}) | ≥ 90 % | ${acc >= 0.9 ? "✅" : "❌"} |`,
    `| 10. Доля дублей | ${pct(r.duplicates.extra, r.duplicates.events)} (${r.duplicates.extra} из ${r.duplicates.events}) | ≤ 5 % | ${r.duplicates.share <= 0.05 ? "✅" : "❌"} |`,
    `| 11. Отменённые, показанные как актуальные | ${r.cancelledShown.length} | 0 | ${r.cancelledShown.length ? "⚠ проверить" : "✅"} |`,
    "",
    `Выборка ${r.sample} опубликованных предстоящих карточек, поровну по источникам; сверено ${r.checked}, страница не загрузилась у ${r.unverified}.`,
    "Карточка точна, если на странице источника есть её название, дата, время (кроме выставок) и цена. Несовпадения ниже — их проверяет человек.",
    "",
    `## Ошибки импорта за ${r.importErrors.days} дней`,
    "",
    `Строк импорта ${r.importErrors.rows}, отклонено ${r.importErrors.rejected}. Ожидают решения изменений: ${r.changes.pending}. Переносов дат за период: ${r.rescheduled}. Вариантов названий площадок в справочнике: ${r.venueAliases}.`,
    "",
    "| Категория | Число | Примеры |",
    "|---|---|---|",
    ...Object.entries(r.importErrors.byCategory).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| Отклонено: ${k} | ${n} | ${(r.importErrors.examples[k] ?? []).join("<br>").replace(/\|/g, "/")} |`),
    ...Object.entries(r.changes.byCategory).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| Конфликт источника: ${k} | ${n} | |`),
    "",
  ];
  const bad = r.cards.filter((c) => c.result !== "ok");
  if (bad.length) {
    lines.push("## Несовпадения и непроверенные", "", "| Карточка | Источник | Начало | Не найдено | Замечания |", "|---|---|---|---|---|");
    for (const c of bad) lines.push(`| [${c.title.replace(/\|/g, "/")}](/events/${c.id}) | [${c.source}](${c.url}) | ${when(c.startsAt)} | ${c.problems.join(", ") || "—"} | ${c.warnings.join("; ").replace(/\|/g, "/")} |`);
    lines.push("");
  }
  if (r.duplicates.examples.length) {
    lines.push("## Дубли", "", ...r.duplicates.examples.map((d) => `- «${d.title}», ${when(d.startsAt)}, ${d.venue}: ${d.count} карточки`), "");
  }
  return lines.join("\n");
}
