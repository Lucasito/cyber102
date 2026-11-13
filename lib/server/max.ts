import "server-only";
import http from "node:http";
import https from "node:https";
import { BOT_COMMANDS, botAnswer, greetingReply, touchBotUser, type BotReply } from "./bot-core";
import { registerSender } from "./jobs";
import { ruTrustAgent } from "./ru-ca";
import { DEFAULT_BOT_GREETING, getSettings, maxToken } from "./settings";

// Бот мессенджера MAX. Клиент API — из crm_spare_parts. Документация: https://dev.max.ru/docs-api
// Токен и включение — в админке (или MAX_BOT_TOKEN в .env). Режимы: MAX_MODE=polling | webhook.

const API_URL = process.env.MAX_API_URL || "https://platform-api2.max.ru";
const TIMEOUT_MS = 8000;

/** int64-идентификаторы MAX не помещаются в JS number — превращаем их в строки до JSON.parse. */
export function parseMaxJson(text: string) {
  return JSON.parse(text.replace(/"(user_id|chat_id|marker|message_id|mid)"\s*:\s*(-?\d{15,})/g, '"$1":"$2"'));
}

export class MaxApiError extends Error {}

async function maxRequest<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  route: string,
  options: { query?: Record<string, string>; body?: unknown; timeoutMs?: number; token?: string } = {},
) {
  const token = options.token ?? (await maxToken());
  if (!token) throw new MaxApiError("Бот MAX выключен или токен не задан");
  const url = new URL(route, API_URL);
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);

  return new Promise<T>((resolve, reject) => {
    const isHttp = url.protocol === "http:"; // http — только для имитации API в тестах
    const req = (isHttp ? http : https).request(
      url,
      {
        method,
        ...(isHttp ? {} : { agent: ruTrustAgent() }),
        headers: { Authorization: token, ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}) },
        timeout: options.timeoutMs ?? TIMEOUT_MS,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) return reject(new MaxApiError(`MAX API ${status}: ${data.slice(0, 300)}`));
          try {
            resolve((data ? parseMaxJson(data) : {}) as T);
          } catch {
            reject(new MaxApiError("MAX API: некорректный ответ"));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new MaxApiError("MAX API: таймаут")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function sendMaxMessage(userId: string, text: string, attachments?: unknown[]) {
  await maxRequest("POST", "/messages", { query: { user_id: userId }, body: { text: text.slice(0, 4000), ...(attachments ? { attachments } : {}) } });
}

/** Кнопки под сообщением: ссылки на события по одной в ряд, подсказки — по две (тип message отправляет текст от пользователя). */
function keyboard(reply: BotReply) {
  // Ссылка на событие и рядом «🔔» — напоминание (callback: payload уходит боту как команда)
  const rows: unknown[][] = reply.links
    .slice(0, 10) // ограничение кнопок платформы; сколько показывать — в настройках
    .map((l) => [{ type: "link", text: l.title.slice(0, 64), url: l.url }, ...(l.eventId ? [{ type: "callback", text: "🔔", payload: `/remind ${l.eventId}` }] : [])]);
  for (const a of reply.actions ?? []) rows.push([{ type: "callback", text: a.label.slice(0, 64), payload: a.command }]);
  for (let i = 0; i < reply.suggestions.length; i += 2) {
    rows.push(reply.suggestions.slice(i, i + 2).map((s) => ({ type: "message", text: s })));
  }
  return rows.length ? [{ type: "inline_keyboard", payload: { buttons: rows } }] : undefined;
}

export async function sendMaxReply(userId: string, reply: BotReply) {
  try {
    await sendMaxMessage(userId, reply.text, keyboard(reply));
  } catch (e) {
    // Кнопки не приняты — отправляем текстом со ссылками, чтобы ответ всё равно дошёл
    console.error("[max] сообщение с кнопками не отправлено:", e instanceof Error ? e.message : e);
    const links = reply.links.map((l) => l.url).join("\n");
    await sendMaxMessage(userId, links ? `${reply.text}\n\n${links}` : reply.text).catch((err) => console.error("[max] ответ не отправлен:", err.message));
  }
}

// Напоминания из фоновой задачи
registerSender("max", (userId, text, link) => sendMaxReply(userId, { text, links: link ? [link] : [], suggestions: [] }));

/** Команды меню бота (видны по «/»). */
export async function setMaxCommands(token: string) {
  await maxRequest("PATCH", "/me/commands", { token, body: { commands: BOT_COMMANDS.map((c) => ({ name: c.command, description: c.description })) } });
}

/** Проверка токена (для админки). */
export const maxGetMe = (token?: string) => maxRequest<{ user_id: string; name: string; username?: string }>("GET", "/me", { token });

// ───────── Входящие события ─────────

type MaxUser = { user_id: string | number; name?: string; first_name?: string };
export type MaxUpdate =
  | { update_type: "bot_started"; user: MaxUser; payload?: string }
  | { update_type: "message_created"; message?: { sender?: MaxUser; body?: { text?: string } } }
  | { update_type: "message_callback"; callback?: { payload?: string; user?: MaxUser } }
  | { update_type: string };

export async function handleMaxUpdate(update: MaxUpdate) {
  const greeting = (await getSettings("max")).greeting || DEFAULT_BOT_GREETING;
  if (update.update_type === "bot_started" && "user" in update) {
    const userId = String(update.user.user_id);
    await touchBotUser("max", userId, update.user.name ?? update.user.first_name ?? null);
    await sendMaxReply(userId, greetingReply(greeting));
    return;
  }
  let sender: MaxUser | undefined;
  let text: string | undefined;
  if (update.update_type === "message_created" && "message" in update) {
    sender = update.message?.sender;
    text = update.message?.body?.text?.trim();
  } else if (update.update_type === "message_callback" && "callback" in update) {
    // На случай кнопок-callback: текст запроса — в payload
    sender = update.callback?.user;
    text = update.callback?.payload?.trim();
  }
  if (!sender || !text) return;
  const userId = String(sender.user_id);
  // «печатает…» на время ответа
  const chatId = "message" in update ? (update.message as { recipient?: { chat_id?: string | number } } | undefined)?.recipient?.chat_id : undefined;
  const typing = () => (chatId != null ? void maxRequest("POST", `/chats/${chatId}/actions`, { body: { action: "typing_on" } }).catch(() => {}) : undefined);
  typing();
  const timer = chatId != null ? setInterval(typing, 4500) : null;
  try {
    await sendMaxReply(userId, await botAnswer("max", userId, sender.name ?? sender.first_name ?? null, text, greeting));
  } finally {
    if (timer) clearInterval(timer);
  }
}

// ───────── Long polling ─────────
// Цикл живёт всё время работы сервера: бот выключен в админке — ждёт; включили — продолжает.

let polling = false;

export async function startMaxPolling() {
  if (polling) return;
  polling = true;
  console.log("[max] long polling запущен");
  let marker: string | undefined;
  let lastToken = "";
  for (;;) {
    const token = await maxToken().catch(() => "");
    if (!token) {
      await sleep(5000);
      continue;
    }
    if (token !== lastToken) {
      marker = undefined; // другой бот — свой поток событий
      lastToken = token;
      await setMaxCommands(token).catch((e) => console.error("[max] команды меню не заданы:", e.message));
    }
    try {
      const res = await maxRequest<{ updates: MaxUpdate[]; marker?: string | number }>("GET", "/updates", {
        query: { timeout: "30", limit: "100", ...(marker ? { marker } : {}) },
        timeoutMs: 40_000,
        token,
      });
      if (res.marker != null) marker = String(res.marker);
      for (const update of res.updates ?? []) await handleMaxUpdate(update).catch((e) => console.error("[max] ошибка обработки:", e));
    } catch (e) {
      console.error("[max] polling:", e instanceof Error ? e.message : e);
      await sleep(5000);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
