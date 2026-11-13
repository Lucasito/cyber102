// Нормализация данных источников (ТЗ 6.5): единые даты, цена из текста, категории и города по справочнику,
// ключ дедупликации. Чистые функции без БД — используются импортом, сборщиками и тестами.

export const TZ_OFFSET = "+05:00"; // Республика Башкортостан, Asia/Yekaterinburg (без перехода на летнее время)

/** «Лебединое озеро» (Гастроли!) → «лебединое озеро гастроли»: регистр, ё, кавычки и знаки не важны. */
export function normalizeTitle(s: string) {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ключ дедупликации (ТЗ 6.5): нормализованное название + местная дата начала + нормализованная площадка. */
/**
 * Ключ дедупликации (ТЗ 6.5): нормализованное название + местные дата и время начала + город + площадка.
 * Время входит в ключ: сеансы одной постановки в 14:00 и 18:00 — два события, а не одно.
 */
export function dedupKey(title: string, startsAt: Date, venue: string | null | undefined, city?: string | null) {
  const at = startsAt.toLocaleString("sv-SE", { timeZone: "Asia/Yekaterinburg" }).slice(0, 16);
  return `${normalizeTitle(title)}|${at}|${normalizeTitle(city ?? "")}|${normalizeTitle(venue ?? "")}`;
}

/**
 * Длительность в минутах: 130, «130 мин», «2:00», «2 ч 10 мин», «2 часа», «1,5 часа», «PT2H10M». Не разобрали — null.
 * (Источники пишут «2:00» — это 120 минут, а не 2.)
 */
export function parseDuration(input: unknown): number | null {
  if (typeof input === "number") return input > 0 && input < 100_000 ? Math.round(input) : null;
  if (typeof input !== "string" || !input.trim()) return null;
  const s = input.trim().toLowerCase().replace(",", ".");
  let m = s.match(/^pt(?:(\d+)h)?(?:(\d+)m)?$/);
  if (m && (m[1] || m[2])) return (+(m[1] ?? 0)) * 60 + +(m[2] ?? 0) || null;
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return +m[1] * 60 + +m[2] || null;
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:ч|час)/);
  const min = s.match(/(\d+)\s*(?:мин|m)/);
  if (h || min) return Math.round((h ? parseFloat(h[1]) * 60 : 0) + (min ? +min[1] : 0)) || null;
  m = s.match(/^(\d+)$/);
  return m && +m[1] > 0 && +m[1] < 100_000 ? +m[1] : null;
}

const MONTHS: Record<string, number> = {
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
};

/**
 * Дата из текста источника → момент времени. Без часового пояса — местное время республики.
 * Понимает: ISO («2026-11-14T19:00», «2026-11-14 19:00», «2026-11-14»), «14.11.2026 19:00», «14 ноября 2026 в 19:00».
 * Год не указан — ближайшая такая дата в будущем. Не разобрали — null.
 */
export function parseDate(input: unknown, now = new Date()): Date | null {
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const build = (y: number, m: number, d: number, hh = 0, mm = 0) => {
    if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
    const date = new Date(`${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00${TZ_OFFSET}`);
    return isNaN(date.getTime()) ? null : date;
  };
  const withYear = (m: number, d: number, hh?: number, mm?: number, y?: number) => {
    if (y) return build(y, m, d, hh, mm);
    // Год не указан: недавняя дата (до полугода назад) — это прошлое, а не следующий год. Иначе старая
    // афиша превратилась бы в ложные будущие события; «5 января» в ноябре — следующий год.
    const year = now.getUTCFullYear();
    const guess = build(year, m, d, hh, mm);
    if (!guess) return null;
    const ago = now.getTime() - guess.getTime();
    return ago > 183 * 86_400_000 ? build(year + 1, m, d, hh, mm) : guess;
  };
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t\s](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?\s*(z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    if (m[6]) {
      const d = new Date(input.trim().replace(" ", "T"));
      return isNaN(d.getTime()) ? null : d;
    }
    return build(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  }
  m = s.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?:[,\s]+(?:в\s+)?(\d{1,2})[:.](\d{2}))?$/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : undefined;
    return withYear(+m[2], +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, y);
  }
  m = s.match(/^(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?(?:\s*(?:г\.?|года)?)?(?:[,\s]+(?:в\s+|начало\s+в\s+)?(\d{1,2})[:.](\d{2}))?$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3)];
    if (!month) return null;
    return withYear(month, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[3] ? +m[3] : undefined);
  }
  return null;
}

/**
 * Цена из текста: «вход свободный», «бесплатно» → 0; «от 300 до 800 ₽» → 300–800; «500 руб.» → 500;
 * «300-800» → 300–800; число → как есть. Не разобрали — null (цена неизвестна, а не бесплатно).
 */
export function parsePrice(input: unknown): { min: number | null; max: number | null } {
  if (typeof input === "number" && isFinite(input) && input >= 0) return { min: Math.round(input), max: Math.round(input) };
  if (typeof input !== "string") return { min: null, max: null };
  const s = input.toLowerCase().replace(/ /g, " ").trim();
  if (!s) return { min: null, max: null };
  if (/бесплат|свободн|free|без оплаты|0\s*(₽|руб)/.test(s) && !/\d{2,}/.test(s.replace(/0\s*(₽|руб)/, ""))) return { min: 0, max: 0 };
  const nums = [...s.replace(/(\d)\s+(?=\d{3}\b)/g, "$1").matchAll(/\d+(?:[.,]\d+)?/g)].map((x) => Math.round(parseFloat(x[0].replace(",", "."))));
  if (!nums.length) return { min: null, max: null };
  if (/^до\s/.test(s)) return { min: null, max: nums[0] };
  // «от 400 ₽», «400 - ₽», «400+» — известен только минимум; верхнюю границу не выдумываем
  if (nums.length === 1 && (/^от\s/.test(s) || /\d\s*[-–—]\s*(₽|руб|р\.?)?\s*$/.test(s) || /\d\s*\+/.test(s))) return { min: nums[0], max: null };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/** Категория из текста источника → код справочника. «Другое» и непонятное — null. */
const CATEGORY_WORDS: [string, RegExp][] = [
  ["theatre", /спектак|театр|драм|опер|балет|мюзикл|theat|perform|play/],
  ["concert", /концерт|музык|джаз|оркестр|хор|вечер.*музык|concert|music|jazz/],
  ["exhibition", /выставк|экспозиц|вернисаж|exhibit|gallery/],
  ["museum", /музей|museum/],
  ["festival", /фестивал|праздник|fest/],
  ["cinema", /кино|фильм|кинопоказ|cinema|film|movie/],
  ["excursion", /экскурс|прогулк|tour|excursion/],
  ["lecture", /лекци|встреч|мастер-класс|семинар|lecture|talk|workshop/],
  ["kids", /дет|kids|child/],
];
export function categorySlug(input: unknown, known: string[]): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const s = input.trim().toLowerCase();
  if (known.includes(s)) return s;
  for (const [slug, re] of CATEGORY_WORDS) if (re.test(s) && known.includes(slug)) return slug;
  return null;
}

/** Расстояние Левенштейна — для опечаток в названиях городов («стерлитакмак» → «Стерлитамак»). */
function distance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Основа слова для сравнения падежей: «в Стерлитамаке» → «стерлитамак», «Уфе» → «уф». */
const stem = (s: string) => normalizeTitle(s).replace(/^(г|город|в|во)\s+/, "").replace(/(ом|ой|ем|е|а|у|ы|и)$/, "");

/**
 * Город к справочнику: точное совпадение, падеж или опечатка (до 2 ошибок на длинных названиях).
 * Не нашли — исходное название с заглавной буквы (новый город появится в справочнике).
 */
export function normalizeCity(input: string, known: string[]): string {
  const raw = input.trim().replace(/^(г\.|город)\s*/i, "");
  if (!raw) return raw;
  const target = stem(raw);
  let best: { city: string; d: number } | null = null;
  for (const city of known) {
    if (normalizeTitle(city) === normalizeTitle(raw)) return city;
    const d = distance(stem(city), target);
    if (!best || d < best.d) best = { city, d };
  }
  const limit = target.length >= 7 ? 2 : target.length >= 4 ? 1 : 0;
  if (best && best.d <= limit) return best.city;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Населённые пункты Республики Башкортостан: 21 город и районные центры. Афиша — только о событиях в РБ:
 * регион проверяется по площадке сеанса, события вне РБ импорт пропускает. Сёла сверх списка добавляются в
 * админке («Тонкая настройка» → «Населённые пункты РБ»).
 */
export const RB_SETTLEMENTS = [
  // города
  "Уфа", "Стерлитамак", "Салават", "Нефтекамск", "Октябрьский", "Туймазы", "Ишимбай", "Кумертау", "Белорецк", "Сибай",
  "Белебей", "Мелеуз", "Бирск", "Учалы", "Благовещенск", "Давлеканово", "Дюртюли", "Янаул", "Баймак", "Агидель", "Межгорье",
  // районные центры (сёла и посёлки)
  "Акъяр", "Аскарово", "Аскино", "Бакалы", "Бижбуляк", "Большеустьикинское", "Буздяк", "Бураево", "Верхнеяркеево", "Верхние Киги",
  "Ермекеево", "Ермолаево", "Зилаир", "Иглино", "Исянгулово", "Караидель", "Кармаскалы", "Киргиз-Мияки", "Красная Горка", "Красноусольский",
  "Кушнаренково", "Малояз", "Месягутово", "Мраково", "Новобелокатай", "Приютово", "Раевский", "Старобалтачево", "Старосубхангулово",
  "Стерлибашево", "Толбазы", "Фёдоровка", "Чекмагуш", "Чишмы", "Шаран", "Языково", "Архангельское", "Верхнеяркеево", "Кандры",
  "Николо-Березовка", "Павловка", "Нурлино", "Серафимовский", "Чесноковка", "Зубово",
];

export function inBashkortostan(city: string, extra: string[] = []) {
  const n = normalizeTitle(city);
  return [...RB_SETTLEMENTS, ...extra].some((c) => normalizeTitle(c) === n);
}

/** Возраст «12+», «6 +», 16 → число; допустимые значения ТЗ: 0, 6, 12, 16, 18. */
export function parseAge(input: unknown): number | null {
  const n = typeof input === "number" ? input : typeof input === "string" ? parseInt(input.replace(/\D+/g, ""), 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 18 ? n : null;
}

/** «да», «true», «1», «+» → true. */
export function parseBool(input: unknown): boolean | null {
  if (typeof input === "boolean") return input;
  if (typeof input === "number") return input !== 0;
  if (typeof input !== "string" || !input.trim()) return null;
  return /^(1|true|да|yes|\+|y)$/i.test(input.trim());
}

/** Метки: массив или строка «джаз, дети; бесплатно». */
export function parseTags(input: unknown): string[] {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[,;|]/) : [];
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter((t) => t && t.length <= 40))].slice(0, 20);
}

export function parseUrl(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  try {
    const u = new URL(input.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
