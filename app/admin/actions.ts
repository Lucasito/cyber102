"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clearDemo, seedDemo } from "@/lib/demo-data";
import { ADMIN_COOKIE, requireAdmin } from "@/lib/server/admin";
import { aiProviderName, chat } from "@/lib/server/ai";
import { db } from "@/lib/server/db";
import { maxGetMe } from "@/lib/server/max";
import { getSettings, maxToken, pick, saveSettings, settingsSchema, telegramConfig, type Settings } from "@/lib/server/settings";
import { telegramGetMe } from "@/lib/server/telegram";

// Каждое действие проверяет доступ: server actions — это открытые POST-эндпоинты.

export type ActionState = { ok: boolean; message: string } | null;

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const flag = (f: FormData, k: string) => f.get(k) === "on";
/** Секретное поле: пусто — оставить прежнее значение; галочка «очистить» — удалить. */
const secret = (f: FormData, k: string, old: string) => (flag(f, `clear_${k}`) ? "" : text(f, k) || old);

function done(message: string): ActionState {
  revalidatePath("/", "layout");
  return { ok: true, message };
}
const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

export async function saveSite(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    await saveSettings("site", {
      heroTitle: text(f, "heroTitle"),
      heroSubtitle: text(f, "heroSubtitle"),
      notice: text(f, "notice"),
      testBanner: flag(f, "testBanner"),
      examples: text(f, "examples").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 6),
    });
    return done("Настройки сайта сохранены");
  } catch (e) {
    return fail(e);
  }
}

export async function saveAi(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const old = await getSettings("ai");
    await saveSettings("ai", {
      enabled: flag(f, "enabled"),
      provider: text(f, "provider") as Settings<"ai">["provider"],
      gigachatModel: text(f, "gigachatModel"),
      gigachatAuthKey: secret(f, "gigachatAuthKey", old.gigachatAuthKey),
      gigachatScope: text(f, "gigachatScope") as Settings<"ai">["gigachatScope"],
      llmApiUrl: text(f, "llmApiUrl"),
      llmApiKey: secret(f, "llmApiKey", old.llmApiKey),
      llmModel: text(f, "llmModel"),
      extraPrompt: text(f, "extraPrompt"),
      concurrency: Math.min(10, Math.max(1, Number(text(f, "concurrency")) || 1)),
      fallback: flag(f, "fallback"),
      rateIpMinute: Math.max(0, Number(text(f, "rateIpMinute")) || 0),
      rateIpDay: Math.max(0, Number(text(f, "rateIpDay")) || 0),
      rateUserMinute: Math.max(0, Number(text(f, "rateUserMinute")) || 0),
      rateUserDay: Math.max(0, Number(text(f, "rateUserDay")) || 0),
    });
    return done(`Сохранено. Сейчас используется: ${(await aiProviderName()) ?? "ИИ выключен"}`);
  } catch (e) {
    return fail(e);
  }
}

export async function testAi(): Promise<ActionState> {
  await requireAdmin();
  try {
    const started = Date.now();
    const answer = await chat([{ role: "user", content: "Ответь одним словом: столица Башкортостана?" }], { maxTokens: 20 });
    return { ok: true, message: `${await aiProviderName()}: «${answer.trim()}» за ${Date.now() - started} мс` };
  } catch (e) {
    return fail(e);
  }
}

export async function saveMax(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const old = await getSettings("max");
    await saveSettings("max", { enabled: flag(f, "enabled"), token: secret(f, "token", old.token), greeting: text(f, "greeting") });
    return done("Настройки MAX сохранены — применяются сразу");
  } catch (e) {
    return fail(e);
  }
}

export async function testMax(): Promise<ActionState> {
  await requireAdmin();
  try {
    const token = await maxToken();
    if (!token) return { ok: false, message: "Бот выключен или токен не задан" };
    const me = await maxGetMe(token);
    return { ok: true, message: `Бот «${me.name}» (@${me.username ?? me.user_id}) отвечает` };
  } catch (e) {
    return fail(e);
  }
}

export async function saveTelegram(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const old = await getSettings("telegram");
    await saveSettings("telegram", {
      enabled: flag(f, "enabled"),
      token: secret(f, "token", old.token),
      apiUrl: text(f, "apiUrl"),
      mode: text(f, "mode") === "webhook" ? "webhook" : "polling",
      greeting: text(f, "greeting"),
    });
    return done("Настройки Telegram сохранены — применяются сразу");
  } catch (e) {
    return fail(e);
  }
}

export async function testTelegram(): Promise<ActionState> {
  await requireAdmin();
  try {
    const cfg = await telegramConfig();
    if (!cfg.token) return { ok: false, message: "Токен не задан" };
    const me = await telegramGetMe(cfg.token, cfg.apiUrl);
    return { ok: true, message: `Бот @${me.username} доступен через ${cfg.apiUrl}` };
  } catch (e) {
    return fail(e);
  }
}

/** Числовые поля раздела «Параметры» — берём все, что объявлены в схеме, кроме текстов и списков. */
const TUNING_TEXT_KEYS = ["clarifyText", "clarifySuggestions", "followupSuggestions"] as const;

export async function saveTuning(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const defaults = settingsSchema.tuning.parse({});
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(defaults)) {
      if ((TUNING_TEXT_KEYS as readonly string[]).includes(key)) continue;
      const raw = text(f, key).replace(",", ".");
      next[key] = raw === "" ? defaults[key as keyof typeof defaults] : Number(raw);
    }
    const lines = (k: string) => text(f, k).split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 10);
    await saveSettings("tuning", {
      ...(next as Settings<"tuning">),
      clarifyText: text(f, "clarifyText"),
      clarifySuggestions: lines("clarifySuggestions"),
      followupSuggestions: lines("followupSuggestions"),
    });
    return done("Параметры сохранены — применяются сразу (значения вне допустимых пределов заменены на стандартные)");
  } catch (e) {
    return fail(e);
  }
}

export async function resetTuning(): Promise<ActionState> {
  await requireAdmin();
  try {
    await saveSettings("tuning", settingsSchema.tuning.parse({}));
    return done("Параметры возвращены к значениям по умолчанию — обновите страницу");
  } catch (e) {
    return fail(e);
  }
}

export async function saveMap(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const old = await getSettings("map");
    const provider = text(f, "provider") === "yandex" ? "yandex" : "osm";
    const yandexKey = secret(f, "yandexKey", old.yandexKey);
    await saveSettings("map", { provider, yandexKey });
    return done(provider === "yandex" && !yandexKey ? "Сохранено, но без ключа показывается OpenStreetMap" : "Настройки карты сохранены");
  } catch (e) {
    return fail(e);
  }
}

export async function loadDemo(): Promise<ActionState> {
  await requireAdmin();
  try {
    return done(`Загружено тестовых событий: ${await seedDemo(db)}`);
  } catch (e) {
    return fail(e);
  }
}

export async function removeDemo(): Promise<ActionState> {
  await requireAdmin();
  try {
    return done(`Удалено тестовых событий: ${await clearDemo(db)}`);
  } catch (e) {
    return fail(e);
  }
}

export async function logout() {
  await requireAdmin();
  (await cookies()).delete(ADMIN_COOKIE);
  redirect("/");
}

/** Для подсказок в форме: какие значения сейчас приходят из .env. */
export async function envFallbacks() {
  await requireAdmin();
  return {
    gigachat: !!process.env.GIGACHAT_AUTH_KEY,
    llm: !!process.env.LLM_API_URL,
    maxToken: !!process.env.MAX_BOT_TOKEN,
    tgToken: !!process.env.TELEGRAM_BOT_TOKEN,
    aiProviderEnv: process.env.AI_PROVIDER ?? "",
    gigachatModelEnv: pick("", process.env.GIGACHAT_MODEL),
  };
}
