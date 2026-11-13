import { timingSafeEqual } from "node:crypto";
import { telegramConfig } from "@/lib/server/settings";
import { telegramHandle, telegramWebhookSecret, type TgUpdate } from "@/lib/server/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook Telegram. Ответ отправляется прямо в теле HTTP-ответа (метод sendMessage) —
 * так бот работает, даже если исходящие запросы к api.telegram.org с сервера заблокированы.
 */
export async function POST(request: Request) {
  const cfg = await telegramConfig();
  if (!cfg.enabled || cfg.mode !== "webhook") return new Response("Not configured", { status: 404 });
  const expected = telegramWebhookSecret(cfg.token);
  const got = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) return new Response("Forbidden", { status: 403 });

  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  const payload = update ? await telegramHandle(update).catch((e) => (console.error("[telegram] webhook:", e), null)) : null;
  if (!payload) return Response.json({ ok: true });
  return Response.json({ method: "sendMessage", ...payload });
}
