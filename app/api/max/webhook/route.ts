import { timingSafeEqual } from "node:crypto";
import { handleMaxUpdate, parseMaxJson } from "@/lib/server/max";
import { maxToken } from "@/lib/server/settings";

/** Webhook MAX (MAX_MODE=webhook). */
export async function POST(request: Request) {
  if (!(await maxToken())) return new Response("Not configured", { status: 404 });
  const expected = process.env.MAX_WEBHOOK_SECRET ?? "";
  const got = request.headers.get("x-max-bot-api-secret") ?? "";
  if (!expected || got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return new Response("Forbidden", { status: 403 });
  }
  const update = parseMaxJson(await request.text());
  // Отвечаем MAX сразу, агент может думать дольше таймаута webhook
  void handleMaxUpdate(update).catch((e) => console.error("[max] webhook:", e));
  return Response.json({ ok: true });
}
