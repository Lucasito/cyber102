import "server-only";
import { z } from "zod";
import { db } from "./db";

// Настройки из админки. Хранятся в таблице Setting (раздел → JSON).
// Пустое значение в админке = берём из переменной окружения (.env).
// Кэш на несколько секунд: боты и ИИ читают настройки на каждом сообщении.

const str = z.string().trim().max(2000).default("");
const bool = z.boolean().default(true);
/** Число в пределах; неверное значение в базе — откат к значению по умолчанию, а не ошибка. */
const num = (min: number, max: number, def: number) => z.coerce.number().min(min).max(max).catch(def).default(def);

export const settingsSchema = {
  site: z.object({
    heroTitle: str,
    heroSubtitle: str,
    notice: str, // объявление над шапкой (пусто — нет)
    testBanner: bool, // плашка «Тестовые данные», пока в базе есть демо-события
    examples: z.array(z.string().trim().max(120)).max(6).default([]),
  }),
  ai: z.object({
    enabled: bool,
    provider: z.enum(["", "gigachat", "openai"]).default(""),
    gigachatModel: str,
    gigachatAuthKey: str,
    gigachatScope: z.enum(["", "GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"]).default(""),
    llmApiUrl: str,
    llmApiKey: str,
    llmModel: str,
    extraPrompt: str, // дополнительные указания агенту
    concurrency: z.coerce.number().int().min(1).max(10).default(1), // одновременных запросов к GigaChat (Freemium — 1 поток)
    fallback: bool, // при перегрузке основного — запасной провайдер, если настроен
    // Лимиты умного поиска; 0 — без ограничения. С одного IP могут ходить многие (NAT площадки, офис) — запас большой
    rateIpMinute: z.coerce.number().int().min(0).max(100_000).default(600),
    rateIpDay: z.coerce.number().int().min(0).max(10_000_000).default(10_000),
    rateUserMinute: z.coerce.number().int().min(0).max(100_000).default(150),
    rateUserDay: z.coerce.number().int().min(0).max(10_000_000).default(2000),
  }),
  /** Настраиваемые параметры работы (раздел «Параметры» в админке). Значения по умолчанию — проверенные. */
  tuning: z.object({
    // ИИ
    aiTimeoutSec: num(5, 300, 60), // ожидание ответа модели
    queueWaitSec: num(5, 600, 60), // сколько запрос может ждать в очереди
    retries: num(0, 10, 3), // повторов при перегрузке (429)
    retryBaseSec: num(0.2, 30, 1.5), // первая пауза, дальше удваивается
    breakerSec: num(0, 3600, 60), // сколько не трогать провайдера после сбоя
    cacheMin: num(0, 1440, 10), // кэш одинаковых запросов
    parseTemperature: num(0, 1, 0.1), // разбор запроса — чем ниже, тем стабильнее
    explainTemperature: num(0, 1.5, 0.2), // объяснение подборки — живость текста
    explainMaxTokens: num(50, 2000, 400),
    dialogMemory: num(2, 40, 10), // сколько реплик помнит помощник
    agentEvents: num(1, 30, 8), // событий в ответе помощника
    // Поиск и сайт
    pageSize: num(6, 96, 24), // карточек на странице каталога
    radiusKm: num(1, 300, 15), // радиус «Рядом со мной»
    kidsAge: num(0, 18, 6), // «с ребёнком» без возраста
    teenAge: num(0, 18, 12), // «с подростком»
    chatEvents: num(1, 20, 4), // карточек под ответом в чате (остальные — «Показать ещё»)
    defaultDurationHours: num(0.5, 48, 3), // событие без даты окончания закончилось через …
    analyticsDays: num(1, 90, 7),
    // Боты
    botEvents: num(1, 10, 5), // событий в ответе бота (кнопки-ссылки)
    // Напоминания
    remindHours: num(1, 168, 24), // за сколько часов до начала
    remindFallbackHours: num(0.5, 24, 2), // если до начала меньше — за столько
    exhibitionRemindDays: num(1, 30, 2), // выставка: за сколько дней до закрытия
    // Тексты помощника (пусто — по умолчанию)
    clarifyText: str,
    clarifySuggestions: z.array(z.string().trim().max(40)).max(10).default([]),
    followupSuggestions: z.array(z.string().trim().max(40)).max(10).default([]),
  }),
  map: z.object({
    provider: z.enum(["osm", "yandex"]).default("osm"),
    // Ключ JavaScript API Яндекс Карт (developer.tech.yandex.ru). Публичный — виден в браузере;
    // в кабинете Яндекса ограничьте его по адресу сайта (HTTP Referer)
    yandexKey: str,
  }),
  max: z.object({
    enabled: bool,
    token: str,
    greeting: str,
  }),
  telegram: z.object({
    enabled: z.boolean().default(false),
    token: str,
    apiUrl: str, // зеркало api.telegram.org — с серверов РФ прямой доступ заблокирован
    mode: z.enum(["polling", "webhook"]).default("polling"),
    greeting: str,
  }),
};

export type SettingsKey = keyof typeof settingsSchema;
export type Settings<K extends SettingsKey> = z.infer<(typeof settingsSchema)[K]>;

const TTL_MS = 5000;
const cache = new Map<SettingsKey, { at: number; value: unknown }>();

export async function getSettings<K extends SettingsKey>(key: K): Promise<Settings<K>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Settings<K>;
  const row = await db.setting.findUnique({ where: { key } }).catch(() => null);
  const parsed = settingsSchema[key].safeParse(row?.value ?? {});
  const value = (parsed.success ? parsed.data : settingsSchema[key].parse({})) as Settings<K>;
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function saveSettings<K extends SettingsKey>(key: K, value: Settings<K>) {
  const data = settingsSchema[key].parse(value);
  await db.setting.upsert({ where: { key }, create: { key, value: data }, update: { value: data } });
  cache.delete(key);
}

/** Значение из админки или из .env. */
export const pick = (fromAdmin: string, env: string | undefined) => fromAdmin || env || "";

// ───────── Готовые значения для модулей ─────────

export const DEFAULT_HERO_TITLE = "Куда сходить в Башкортостане";
export const DEFAULT_HERO_SUBTITLE = "Спектакли, концерты, выставки и музеи республики. Опишите запрос своими словами — помощник подберёт события из афиши.";
export const DEFAULT_EXAMPLES = ["Куда пойти в субботу с ребёнком до 1000 ₽", "Бесплатные выставки в Уфе на неделе", "Концерт классической музыки вечером"];
export const DEFAULT_BOT_GREETING =
  "Здравствуйте! Я помощник афиши культуры Башкортостана. Напишите, что ищете, например: «куда пойти в субботу с ребёнком до 1000 рублей» — подберу события из афиши.";

/**
 * Временный общий выключатель ботов (MAX и Telegram): пока true — боты не работают независимо
 * от настроек в админке: опрос не идёт, webhook отвечает 404, ссылки на ботов на сайте скрыты,
 * напоминания в мессенджеры не отправляются. Чтобы включить — поставить false.
 */
export const BOTS_PAUSED = true;

export async function maxToken() {
  if (BOTS_PAUSED) return "";
  const s = await getSettings("max");
  return s.enabled ? pick(s.token, process.env.MAX_BOT_TOKEN) : "";
}

export async function telegramConfig() {
  const s = await getSettings("telegram");
  const token = pick(s.token, process.env.TELEGRAM_BOT_TOKEN);
  return {
    enabled: !BOTS_PAUSED && s.enabled && !!token,
    token,
    apiUrl: pick(s.apiUrl, process.env.TELEGRAM_API_URL) || "https://api.telegram.org",
    mode: s.mode,
    greeting: s.greeting || DEFAULT_BOT_GREETING,
  };
}

/** Какую карту показывать на сайте. Яндекс — только если выбран и задан ключ, иначе OpenStreetMap. */
export async function mapConfig(): Promise<{ provider: "osm" | "yandex"; yandexKey?: string }> {
  const s = await getSettings("map");
  return s.provider === "yandex" && s.yandexKey ? { provider: "yandex", yandexKey: s.yandexKey } : { provider: "osm" };
}

/** Маска секрета для показа в админке: «abcd…wxyz». */
export function maskSecret(v: string) {
  if (!v) return "";
  return v.length <= 10 ? "••••" : `${v.slice(0, 4)}…${v.slice(-4)}`;
}
