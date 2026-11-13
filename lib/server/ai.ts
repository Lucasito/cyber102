import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { ruTrustAgent } from "./ru-ca";
import { getSettings, pick, type Settings } from "./settings";

// Языковая модель для ИИ-агента афиши. Основа — lib/server/ai.ts из crm_spare_parts.
//
// Провайдер и ключи задаются в админке (раздел «ИИ»); пустые поля — из переменных .env:
//   gigachat — GigaChat (Сбер), серверы в РФ. GIGACHAT_AUTH_KEY, GIGACHAT_MODEL.
//   openai   — любой OpenAI-совместимый API: OpenRouter, YandexGPT (OpenAI-режим),
//              DeepSeek, свой Ollama/vLLM. LLM_API_URL (до /chat/completions), LLM_API_KEY, LLM_MODEL.
// Провайдер не выбран — первый настроенный: gigachat, затем openai. AI_PROVIDER=none в .env — ИИ выключен.
// Переключение применяется сразу, без перезапуска.

const TIMEOUT_MS = 60_000;
const GIGACHAT_AUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const GIGACHAT_API_URL = "https://api.giga.chat/v1";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type Provider = { name: string; url: string; model: string; auth: () => Promise<string>; agent?: https.Agent };

export type ProviderKind = "gigachat" | "openai";
export const DEFAULT_GIGACHAT_MODEL = "GigaChat-3-Ultra";

/** Оба провайдера по текущим настройкам (null — не настроен). */
async function providers(): Promise<Record<ProviderKind, Provider | null>> {
  const s = await getSettings("ai");
  const gigaKey = pick(s.gigachatAuthKey, process.env.GIGACHAT_AUTH_KEY);
  const gigaScope = pick(s.gigachatScope, process.env.GIGACHAT_SCOPE) || "GIGACHAT_API_PERS";
  const gigaModel = pick(s.gigachatModel, process.env.GIGACHAT_MODEL) || DEFAULT_GIGACHAT_MODEL;
  const llmUrl = pick(s.llmApiUrl, process.env.LLM_API_URL);
  const llmModel = pick(s.llmModel, process.env.LLM_MODEL);
  const llmKey = pick(s.llmApiKey, process.env.LLM_API_KEY);
  return {
    gigachat: gigaKey
      ? {
          name: `gigachat:${gigaModel}`,
          url: (process.env.GIGACHAT_API_URL || GIGACHAT_API_URL).replace(/\/$/, ""),
          model: gigaModel,
          auth: () => gigachatToken(gigaKey, gigaScope),
          agent: ruTrustAgent(),
        }
      : null,
    openai: llmUrl ? { name: `openai:${llmModel}`, url: llmUrl.replace(/\/$/, ""), model: llmModel, auth: async () => llmKey } : null,
  };
}

async function provider(): Promise<Provider | null> {
  const s = await getSettings("ai");
  if (!s.enabled || process.env.AI_PROVIDER === "none") return null;
  const p = await providers();
  switch (s.provider || (process.env.AI_PROVIDER || "").toLowerCase()) {
    case "gigachat":
      return p.gigachat;
    case "openai":
      return p.openai;
    default:
      return p.gigachat ?? p.openai;
  }
}

/** Группа лимитов, из которой тратит модель: GigaChat-3-Ultra → «GigaChat-Ultra», GigaChat-2-Max → «GigaChat-Max»… */
export function gigachatUsageGroup(model: string) {
  const m = model.match(/-(Max|Ultra|Pro)$/i);
  return m ? `GigaChat-${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}` : "GigaChat";
}

let balanceCache: { at: number; value: { usage: string; value: number }[] } | null = null;

/** Остаток токенов GigaChat по группам моделей (GET /balance), кэш 1 минута. Только для предоплаченных пакетов и Freemium. */
export async function gigachatBalance(): Promise<{ items: { usage: string; value: number }[]; model: string | null; error?: string }> {
  const p = (await providers()).gigachat;
  if (!p) return { items: [], model: null, error: "Ключ GigaChat не задан" };
  if (balanceCache && Date.now() - balanceCache.at < 60_000) return { items: balanceCache.value, model: p.model };
  try {
    const token = await p.auth();
    const res = await request(`${p.url}/balance`, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, agent: p.agent, timeoutMs: 8000 });
    if (res.status === 403) return { items: [], model: p.model, error: "Баланс недоступен: при оплате по факту (CORP) лимитов нет" };
    if (res.status !== 200) throw new AiError(`ошибка ${res.status}`);
    const items = ((JSON.parse(res.text) as { balance?: { usage: string; value: number }[] }).balance ?? []).sort((a, b) => a.usage.localeCompare(b.usage));
    balanceCache = { at: Date.now(), value: items };
    return { items, model: p.model };
  } catch (e) {
    return { items: [], model: p.model, error: `Баланс недоступен: ${e instanceof Error ? e.message : e}` };
  }
}

/** Запасной список, если API моделей недоступен. */
const FALLBACK_MODELS: Record<ProviderKind, string[]> = {
  gigachat: ["GigaChat-3-Ultra", "GigaChat-3-Pro", "GigaChat-3-Lightning", "GigaChat-2-Max", "GigaChat-2-Pro", "GigaChat-2"],
  openai: [],
};
const modelsCache = new Map<string, { at: number; list: string[] }>();

/** Модели для чата у провайдера (GET /models), кэш 10 минут. */
export async function listModels(kind: ProviderKind): Promise<{ models: string[]; error?: string }> {
  const p = (await providers())[kind];
  if (!p) return { models: FALLBACK_MODELS[kind], error: "Провайдер не настроен" };
  const cached = modelsCache.get(p.url);
  if (cached && Date.now() - cached.at < 600_000) return { models: cached.list };
  try {
    const token = await p.auth();
    const res = await request(`${p.url}/models`, {
      method: "GET",
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      agent: p.agent,
      timeoutMs: 8000,
    });
    if (res.status !== 200) throw new AiError(`ошибка ${res.status}`);
    const data = JSON.parse(res.text) as { data?: { id: string; type?: string }[] };
    // У GigaChat в списке есть модели эмбеддингов — для чата они не годятся
    const list = (data.data ?? []).filter((m) => !m.type || m.type === "chat").map((m) => m.id).sort((a, b) => b.localeCompare(a));
    modelsCache.set(p.url, { at: Date.now(), list });
    return { models: list };
  } catch (e) {
    return { models: FALLBACK_MODELS[kind], error: `Список моделей недоступен: ${e instanceof Error ? e.message : e}` };
  }
}

export async function aiConfigured() {
  return (await provider()) !== null;
}

export async function aiProviderName() {
  return (await provider())?.name ?? null;
}

export class AiError extends Error {}

function request(url: string, options: { method: string; headers: Record<string, string>; body?: string; agent?: https.Agent; timeoutMs?: number }) {
  const target = new URL(url);
  const isHttp = target.protocol === "http:";
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = (isHttp ? http : https).request(
      target,
      {
        method: options.method,
        ...(isHttp || !options.agent ? {} : { agent: options.agent }),
        headers: { ...options.headers, ...(options.body != null ? { "Content-Length": String(Buffer.byteLength(options.body)) } : {}) },
        timeout: options.timeoutMs ?? TIMEOUT_MS,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("timeout", () => req.destroy(new AiError("ИИ не ответил вовремя — попробуйте ещё раз")));
    req.on("error", reject);
    if (options.body != null) req.write(options.body);
    req.end();
  });
}

// Токен GigaChat живёт 30 минут — держим в памяти, одновременные запросы ждут один общий запрос токена
let gigachatCache: { key: string; token: string; expiresAt: number } | null = null;
let gigachatPending: Promise<string> | null = null;

async function gigachatToken(key: string, scope: string) {
  if (gigachatCache?.key === `${scope}:${key}` && gigachatCache.expiresAt - Date.now() > 60_000) return gigachatCache.token;
  gigachatPending ??= fetchGigachatToken(key, scope).finally(() => {
    gigachatPending = null;
  });
  return gigachatPending;
}

async function fetchGigachatToken(key: string, scope: string) {
  const res = await request(process.env.GIGACHAT_AUTH_URL || GIGACHAT_AUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${key}`,
      RqUID: randomUUID(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ scope }).toString(),
    agent: ruTrustAgent(),
  });
  if (res.status === 429) throw new AiError("GigaChat: слишком много запросов — попробуйте через минуту");
  if (res.status !== 200) throw new AiError(`GigaChat: не удалось получить токен (${res.status})`);
  const data = JSON.parse(res.text) as { access_token: string; expires_at: number };
  gigachatCache = { key: `${scope}:${key}`, token: data.access_token, expiresAt: data.expires_at };
  return data.access_token;
}

// ───────── Устойчивость к перегрузке ─────────
// Бесплатный GigaChat обрабатывает один запрос за раз, на параллельные отвечает 429.
// Поэтому: очередь с лимитом одновременных запросов → повтор с паузой при 429/сбое →
// запасной провайдер (если настроен) → кэш одинаковых запросов. Агент сверх этого умеет
// работать вовсе без ИИ (см. agent.ts).

/** Ошибка, после которой есть смысл повторить запрос (перегрузка, сбой сети, 5xx). */
export class AiRetryableError extends AiError {}

/** Параметры устойчивости — из админки (раздел «Параметры»). */
type Tuning = Settings<"tuning">;

class Limiter {
  waitMs = 60_000;
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(public max: number) {}
  get queued() {
    return this.waiting.length;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < this.max) this.active++;
    else {
      // Ждём, пока завершившийся запрос передаст нам своё место (active при этом не меняется)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiting = this.waiting.filter((w) => w !== go);
          reject(new AiRetryableError("ИИ сейчас перегружен — попробуйте через минуту"));
        }, this.waitMs);
        const go = () => {
          clearTimeout(timer);
          resolve();
        };
        this.waiting.push(go);
      });
    }
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next && this.active <= this.max) next();
      else {
        this.active--;
        if (next) this.waiting.unshift(next); // лимит уменьшили в админке — следующий подождёт освобождения
      }
    }
  }
}

const limiters = new Map<ProviderKind, Limiter>();
function limiterFor(kind: ProviderKind, max: number, waitMs: number) {
  let l = limiters.get(kind);
  if (!l) limiters.set(kind, (l = new Limiter(max)));
  l.max = max;
  l.waitMs = waitMs;
  return l;
}

/** Состояние очередей — для админки. */
export function aiQueueStats() {
  return [...limiters.entries()].map(([kind, l]) => ({ kind, max: l.max, queued: l.queued, down: (downUntil.get(kind) ?? 0) > Date.now() }));
}

const responseCache = new Map<string, { at: number; text: string }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** «Предохранитель»: провайдер, не ответивший после всех повторов, какое-то время не трогаем — сразу запасной или шаблон. */
const downUntil = new Map<ProviderKind, number>();

// ───────── Учёт токенов и стоимости ─────────
// Агент оборачивает ответ в withAiUsage: каждый вызов chat() внутри записывает провайдера, токены, задержку.
// Стоимость — по цене за 1000 токенов из админки (раздел «ИИ» → «Стоимость»).

export type AiCall = { provider: string; tokens: number; ms: number; cached?: boolean; error?: string };
const usageStore = new AsyncLocalStorage<AiCall[]>();

/** Выполнить fn и вернуть все вызовы модели внутри неё. */
export async function withAiUsage<T>(fn: () => Promise<T>): Promise<{ result: T; calls: AiCall[] }> {
  const calls: AiCall[] = [];
  const result = await usageStore.run(calls, fn);
  return { result, calls };
}

/** Стоимость токенов в рублях по цене из админки. */
export async function tokensCostRub(tokens: number) {
  const s = await getSettings("ai");
  return Math.round(((tokens / 1000) * s.priceRubPer1k) * 10000) / 10000;
}

/** Один запрос к провайдеру с повторами: перегрузка (429) — до t.retries раз с удвоением паузы, сбой сети — один. */
async function callProvider(kind: ProviderKind, p: Provider, body: string, t: Tuning): Promise<{ text: string; tokens: number }> {
  let lastError: unknown;
  let networkFailures = 0;
  for (let attempt = 0; attempt <= t.retries; attempt++) {
    if (attempt > 0) await sleep(t.retryBaseSec * 1000 * 2 ** (attempt - 1) + Math.random() * 500);
    try {
      const token = await p.auth();
      const res = await request(`${p.url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body,
        agent: p.agent,
        timeoutMs: t.aiTimeoutSec * 1000,
      });
      if (res.status === 401 && kind === "gigachat") {
        gigachatCache = null; // токен истёк раньше срока — получим новый при повторе
        throw new AiRetryableError("ИИ: токен устарел");
      }
      if (res.status === 429 || res.status >= 500) throw new AiRetryableError(res.status === 429 ? "ИИ перегружен (429)" : `ИИ: ошибка ${res.status}`);
      if (res.status < 200 || res.status >= 300) throw new AiError(`ИИ: ошибка ${res.status} ${res.text.slice(0, 200)}`);
      const data = JSON.parse(res.text) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
      const text = data.choices?.[0]?.message?.content ?? "";
      // Провайдер не вернул usage — оцениваем: ~4 символа на токен
      const tokens = data.usage?.total_tokens ?? Math.ceil((body.length + text.length) / 4);
      return { text, tokens };
    } catch (e) {
      lastError = e;
      const overload = e instanceof AiError && /429|слишком много|перегружен|токен устарел/.test(e.message);
      const network = !(e instanceof AiError) || (e instanceof AiRetryableError && !overload);
      if (!overload && !network) throw e;
      console.warn(`[ai] ${p.name}: ${e instanceof Error ? e.message : e}, попытка ${attempt + 1}`);
      if (network && ++networkFailures >= 2) break; // сеть/5xx — один повтор, дальше не ждём
    }
  }
  downUntil.set(kind, Date.now() + t.breakerSec * 1000);
  console.warn(`[ai] ${p.name} недоступен — не используем ${t.breakerSec} с`);
  throw new AiRetryableError(lastError instanceof AiError && /429|перегружен/.test(lastError.message) ? "ИИ сейчас перегружен" : "ИИ сейчас недоступен");
}

/** Диалог с моделью, ответ — текст. Очередь, повторы, запасной провайдер, кэш. */
export async function chat(messages: ChatMessage[], { temperature = 0.3, maxTokens = 1500 } = {}): Promise<string> {
  const [s, t] = await Promise.all([getSettings("ai"), getSettings("tuning")]);
  const primary = await provider();
  if (!primary) throw new AiError("ИИ не подключён");
  const all = await providers();
  const primaryKind: ProviderKind = primary === all.gigachat ? "gigachat" : "openai";
  const secondaryKind: ProviderKind = primaryKind === "gigachat" ? "openai" : "gigachat";
  const chain: [ProviderKind, Provider][] = [[primaryKind, primary]];
  if (s.fallback && all[secondaryKind]) chain.push([secondaryKind, all[secondaryKind]!]);

  const cacheKey = `${primary.name}|${temperature}|${maxTokens}|${JSON.stringify(messages)}`;
  const calls = usageStore.getStore();
  const hit = responseCache.get(cacheKey);
  if (hit && Date.now() - hit.at < t.cacheMin * 60_000) {
    calls?.push({ provider: primary.name, tokens: 0, ms: 0, cached: true });
    return hit.text;
  }

  let lastError: unknown = new AiRetryableError("ИИ сейчас недоступен");
  for (const [kind, p] of chain) {
    if ((downUntil.get(kind) ?? 0) > Date.now()) continue; // сработал предохранитель
    const body = JSON.stringify({ model: p.model, messages, temperature, max_tokens: maxTokens });
    // GigaChat Freemium — один поток; OpenAI-совместимые обычно держат несколько
    const limit = kind === "gigachat" ? s.concurrency : Math.max(s.concurrency, 4);
    const started = Date.now();
    try {
      const { text, tokens } = await limiterFor(kind, limit, t.queueWaitSec * 1000).run(() => callProvider(kind, p, body, t));
      calls?.push({ provider: p.name, tokens, ms: Date.now() - started });
      if (t.cacheMin > 0) {
        if (responseCache.size > 300) responseCache.delete(responseCache.keys().next().value!);
        responseCache.set(cacheKey, { at: Date.now(), text });
      }
      return text;
    } catch (e) {
      lastError = e;
      calls?.push({ provider: p.name, tokens: 0, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) });
      if (!(e instanceof AiRetryableError)) throw e;
      if (chain.length > 1) console.warn(`[ai] ${p.name} недоступен, пробуем запасной провайдер`);
    }
  }
  throw lastError;
}

/** Первый JSON-объект в ответе модели (модели любят обрамлять его текстом и ```). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("ИИ ответил не в том формате");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AiError("ИИ ответил не в том формате");
  }
}

/** Запрос к модели с ответом в виде JSON-объекта (разбор свободного запроса в фильтры и т. п.). */
export async function askJson(system: string, user: string, { maxTokens = 1500 } = {}): Promise<unknown> {
  const t = await getSettings("tuning");
  return extractJson(await chat([{ role: "system", content: system }, { role: "user", content: user }], { temperature: t.parseTemperature, maxTokens }));
}
