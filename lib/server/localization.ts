import "server-only";
import { i18nPairs } from "@/lib/i18n";
import { agentPhrasePairs } from "./agent";
import { getSettings } from "./settings";

// Башкирская локализация: выгрузка и загрузка CSV «русский;башкирский» (раздел «Сайт» в админке).
// Ключ строки — русский текст: в файле два столбца, без служебных кодов, — удобно переводчику.

export type LocEntry = { ru: string; ba: string; builtin: string; overridden: boolean };

/** Все строки интерфейса и помощника: русский, текущий башкирский (из админки или встроенный). */
export async function localizationEntries(): Promise<LocEntry[]> {
  const overrides = (await getSettings("i18n")).ba;
  const seen = new Map<string, LocEntry>();
  for (const { ru, ba } of [...i18nPairs(), ...agentPhrasePairs()]) {
    if (!ru || seen.has(ru)) continue;
    const o = overrides[ru];
    seen.set(ru, { ru, ba: o || ba, builtin: ba, overridden: !!o && o !== ba });
  }
  return [...seen.values()];
}

const cell = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV для Excel: UTF-8 с BOM, разделитель «;», первый столбец — русский, второй — башкирский. */
export function toCsv(entries: { ru: string; ba: string }[]) {
  return "﻿" + ["Русский;Башкирский", ...entries.map((e) => `${cell(e.ru)};${cell(e.ba)}`)].join("\r\n") + "\r\n";
}

/** Разбор CSV: разделитель «;», «,» или табуляция (по первой строке), кавычки, переносы строк внутри ячеек. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [";", ",", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const).sort((a, b) => b[1] - a[1]);
  const delim = counts[0][1] > 0 ? counts[0][0] : ";";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur === "") quoted = true;
    else if (ch === delim) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type LocCheck = { errors: string[]; warnings: string[]; map: Record<string, string>; rows: number; changed: number };

const placeholders = (s: string) => [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join(" ");

/**
 * Проверка загружаемого файла. Ошибка — файл не принимается целиком (ничего не меняется); предупреждение —
 * принимается, но стоит посмотреть. Проверяется: два столбца, русский текст есть в интерфейсе, перевод не пустой,
 * переменные {…} сохранены, нет HTML, нет противоречивых повторов.
 */
export async function checkLocalization(text: string): Promise<LocCheck> {
  const entries = await localizationEntries();
  const known = new Map(entries.map((e) => [e.ru.trim(), e]));
  const errors: string[] = [];
  const warnings: string[] = [];
  const map: Record<string, string> = {};
  let rows = parseCsv(text);
  if (!rows.length) return { errors: ["Файл пустой"], warnings, map, rows: 0, changed: 0 };
  // Заголовок «Русский;Башкирский» (или похожий) — пропускаем
  if (/^рус/i.test(rows[0][0]?.trim() ?? "") && /^(баш|ba)/i.test(rows[0][1]?.trim() ?? "")) rows = rows.slice(1);
  const err = (n: number, msg: string) => {
    if (errors.length < 30) errors.push(`Строка ${n}: ${msg}`);
  };
  const warn = (n: number, msg: string) => {
    if (warnings.length < 30) warnings.push(`Строка ${n}: ${msg}`);
  };
  let changed = 0;
  rows.forEach((r, i) => {
    const n = i + 2;
    if (r.length < 2) return void err(n, "нужно два столбца — русский и башкирский");
    if (r.length > 2 && r.slice(2).some((c) => c.trim())) warn(n, "лишние столбцы после второго не учитываются");
    const ru = r[0].trim();
    const ba = r[1].trim();
    const entry = known.get(ru);
    if (!entry) return void err(n, `русского текста «${ru.slice(0, 80)}» нет в интерфейсе — его нельзя менять в файле, только перевод`);
    if (!ba) return void err(n, `пустой перевод для «${ru.slice(0, 60)}»`);
    if (/<[a-z/!][^>]*>/i.test(ba)) return void err(n, "в переводе HTML-разметка — нужен простой текст");
    if (placeholders(ru) !== placeholders(ba)) return void err(n, `в переводе должны остаться переменные ${placeholders(ru) || "—"} (в тексте: ${placeholders(ba) || "нет"})`);
    if (ba.length > ru.length * 3 + 60) warn(n, "перевод намного длиннее русского — может не поместиться в интерфейсе");
    if (ba === ru && !/^[A-Za-z0-9 .,:+–—-]+$/.test(ru)) warn(n, `перевод совпадает с русским — «${ru.slice(0, 50)}»`);
    if (!/[а-яёәөүҡғҙҫһң]/i.test(ba) && /[а-яё]/i.test(ru)) warn(n, "в переводе нет кириллицы — проверьте кодировку");
    if (map[ru] !== undefined && map[ru] !== ba) return void err(n, `«${ru.slice(0, 60)}» уже встречалась с другим переводом`);
    if (map[ru] === undefined && ba !== entry.ba) changed++;
    map[ru] = ba;
  });
  // Кракозябры вместо кириллицы — файл не в UTF-8 (например, сохранён в ANSI)
  if (/Ð|Ñ|Ã|�/.test(text)) errors.unshift("Похоже, файл не в кодировке UTF-8 (видны «кракозябры»). Сохраните его как «CSV UTF-8».");
  const missing = entries.filter((e) => map[e.ru] === undefined).length;
  if (missing && !errors.length) warnings.push(`В файле нет ${missing} строк — для них останется текущий перевод`);
  return { errors, warnings, map, rows: rows.length, changed };
}
