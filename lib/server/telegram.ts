import "server-only";
import { createHash } from "node:crypto";
import { BOT_COMMANDS, botAnswer, NO_LOCATION, SEND_LOCATION, type BotReply } from "./bot-core";
import { registerSender } from "./jobs";
import { telegramConfig } from "./settings";

// Бот Telegram. С серверов в РФ api.telegram.org заблокирован, поэтому два режима:
//  • polling — сервер сам опрашивает Telegram через «Адрес API» из админки
//    (зеркало api.telegram.org: Cloudflare Worker из docs/telegram-proxy-worker.js);
//  • webhook — Telegram сам присылает сообщения на /api/telegram/webhook, а ответ
//    возвращается прямо в теле HTTP-ответа — исходящий доступ к Telegram не нужен.
//    Входящие от Telegram тоже режутся с перебоями — ответы могут задерживаться.
//
// Меню: команды (/today, /weekend…) и кнопки под сообщением (инлайн): главное меню после /start,
// поиск кнопками, карточки событий, подписки; подсказки — нажатие отправляет запрос.

export class TelegramError extends Error {}

type TgUser = { id: number; first_name?: string; username?: string };
type TgChat = { id: number; type: string };
export type TgUpdate = {
  update_id: number;
  message?: { chat: TgChat; from?: TgUser; text?: string; location?: { latitude: number; longitude: number } };
  callback_query?: { id: string; from: TgUser; data?: string; message?: { chat: TgChat } };
};
const ALLOWED_UPDATES = ["message", "callback_query"];
/** Префикс данных кнопки-подсказки. Лимит callback_data — 64 байта. */
const Q = "q:";

async function tg<T>(method: string, body: unknown, opts: { token?: string; apiUrl?: string; timeoutMs?: number } = {}): Promise<T> {
  const cfg = await telegramConfig();
  const token = opts.token ?? cfg.token;
  if (!token) throw new TelegramError("Токен Telegram не задан");
  const base = (opts.apiUrl ?? cfg.apiUrl).replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch (e) {
    throw new TelegramError(`Telegram недоступен по адресу ${base} (${e instanceof Error ? e.message : e}). С серверов РФ нужен прокси-адрес API или режим webhook.`);
  }
  const data = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string } | null;
  if (!data?.ok) throw new TelegramError(`Telegram: ${data?.description ?? res.status}`);
  return data.result as T;
}

export const telegramGetMe = (token?: string, apiUrl?: string) => tg<{ id: number; username: string; first_name: string }>("getMe", {}, { token, apiUrl });

export async function setTelegramCommands() {
  await tg("setMyCommands", { commands: BOT_COMMANDS.map((c) => ({ command: c.command, description: c.description })) });
}

/** Секрет webhook — производный от токена, чтобы не хранить отдельно. */
export function telegramWebhookSecret(token: string) {
  return createHash("sha256").update(`afisha-webhook:${token}`).digest("hex").slice(0, 48);
}

/** Ссылка, открыв которую в браузере (где Telegram доступен), регистрируем webhook. */
export function telegramSetWebhookUrl(token: string) {
  const hook = `${process.env.PUBLIC_URL ?? ""}/api/telegram/webhook`;
  const q = new URLSearchParams({ url: hook, secret_token: telegramWebhookSecret(token), allowed_updates: JSON.stringify(ALLOWED_UPDATES) });
  return `https://api.telegram.org/bot${token}/setWebhook?${q}`;
}

export function telegramDeleteWebhookUrl(token: string) {
  return `https://api.telegram.org/bot${token}/deleteWebhook`;
}

/** Обрезка подсказки под лимит callback_data (64 байта UTF-8). */
function callbackData(text: string) {
  let s = text;
  while (Buffer.byteLength(Q + s) > 64) s = s.slice(0, -1);
  return Q + s;
}

/** sendMessage с кнопками под сообщением (инлайн): ссылки, команды поиска кнопками, подсказки. */
export function sendMessagePayload(chatId: number, reply: BotReply) {
  // «Рядом со мной»: геопозицию можно запросить только кнопкой обычной клавиатуры (не инлайн); скрывается после нажатия
  if (reply.askLocation) {
    return {
      chat_id: chatId,
      text: reply.text.slice(0, 4000),
      reply_markup: { keyboard: [[{ text: SEND_LOCATION, request_location: true }], [{ text: NO_LOCATION }]], one_time_keyboard: true, resize_keyboard: true },
    };
  }
  // Ссылка на событие и рядом «🔔» — напоминание
  const rows: unknown[][] = reply.links
    .slice(0, 10) // ограничение кнопок платформы; сколько показывать — в настройках
    .map((l) => [{ text: l.title.slice(0, 60), url: l.url }, ...(l.eventId ? [{ text: "🔔", callback_data: callbackData(`/remind ${l.eventId}`) }] : [])]);
  for (const a of reply.actions ?? []) rows.push([{ text: a.label.slice(0, 60), callback_data: callbackData(a.command) }]);
  for (const row of reply.buttons ?? []) {
    rows.push(row.map((b) => (b.url ? { text: b.label.slice(0, 60), url: b.url } : { text: b.label.slice(0, 60), callback_data: callbackData(b.command ?? b.label) })));
  }
  for (let i = 0; i < reply.suggestions.length; i += 2) {
    rows.push(reply.suggestions.slice(i, i + 2).map((s) => ({ text: s, callback_data: callbackData(s) })));
  }
  const replyMarkup = rows.length ? { inline_keyboard: rows.slice(0, 40) } : undefined;
  return { chat_id: chatId, text: reply.text.slice(0, 4000), link_preview_options: { is_disabled: true }, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) };
}

/** Обработка сообщения или нажатия кнопки → готовый payload для sendMessage (или null). */
export async function telegramHandle(update: TgUpdate): Promise<ReturnType<typeof sendMessagePayload> | null> {
  const cfg = await telegramConfig();
  const m = update.message;
  const cb = update.callback_query;
  let chat: TgChat | undefined;
  let from: TgUser | undefined;
  let text: string | undefined;
  let location: { lat: number; lon: number } | undefined;
  if (m?.location) {
    // Геопозиция, отправленная кнопкой: только для повторного поиска «рядом», не сохраняется
    chat = m.chat;
    from = m.from;
    text = "📍";
    location = { lat: m.location.latitude, lon: m.location.longitude };
  } else if (m?.text) {
    chat = m.chat;
    from = m.from;
    text = m.text.trim();
  } else if (cb?.data?.startsWith(Q) && cb.message) {
    chat = cb.message.chat;
    from = cb.from;
    text = cb.data.slice(Q.length);
    // Убираем «часики» на кнопке (в режиме webhook исходящих запросов нет — пропускаем)
    if (cfg.mode === "polling") void tg("answerCallbackQuery", { callback_query_id: cb.id }).catch(() => {});
  }
  if (!chat || !text || chat.type !== "private") return null;
  // «печатает…» на время ответа (статус живёт 5 с — обновляем); в режиме webhook исходящих нет
  const chatId = chat.id;
  const typing = () => void tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  const timer = cfg.mode === "polling" ? (typing(), setInterval(typing, 4500)) : null;
  try {
    const reply = await botAnswer("telegram", String(from?.id ?? chat.id), text, cfg.greeting, location);
    return sendMessagePayload(chat.id, reply);
  } finally {
    if (timer) clearInterval(timer);
  }
}

// Напоминания из фоновой задачи. В личном чате chat_id совпадает с id пользователя.
// В режиме webhook исходящих запросов нет — напоминания уйдут, только если задан адрес API (воркер).
registerSender("telegram", async (userId, text, links) => {
  await tg("sendMessage", sendMessagePayload(Number(userId), { text, links, suggestions: [] }));
});

// ───────── Long polling ─────────

let polling = false;

export async function startTelegramPolling() {
  if (polling) return;
  polling = true;
  console.log("[telegram] цикл опроса запущен");
  let offset = 0;
  let lastError = "";
  let commandsFor = "";
  for (;;) {
    const cfg = await telegramConfig().catch(() => null);
    if (!cfg?.enabled || cfg.mode !== "polling") {
      await sleep(5000);
      continue;
    }
    try {
      if (commandsFor !== cfg.token) {
        await setTelegramCommands().catch((e) => console.error("[telegram] команды меню не заданы:", e.message));
        commandsFor = cfg.token;
      }
      const updates = await tg<TgUpdate[]>("getUpdates", { offset, timeout: 30, allowed_updates: ALLOWED_UPDATES }, { timeoutMs: 40_000 });
      lastError = "";
      for (const u of updates) {
        offset = u.update_id + 1;
        const payload = await telegramHandle(u).catch((e) => (console.error("[telegram] обработка:", e), null));
        if (payload) await tg("sendMessage", payload).catch((e) => console.error("[telegram] отправка:", e.message));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Остался webhook от прежнего режима — Telegram не отдаёт сообщения опросом, пока он установлен
      if (/webhook is active/i.test(msg)) {
        await tg("deleteWebhook", { drop_pending_updates: false }).catch(() => {});
        console.log("[telegram] webhook снят, переходим на опрос");
        continue;
      }
      if (msg !== lastError) console.error("[telegram] polling:", msg); // не засоряем лог одинаковыми ошибками
      lastError = msg;
      await sleep(15_000);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
