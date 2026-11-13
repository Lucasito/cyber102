import { z } from "zod";
import { runAgent } from "@/lib/server/agent";
import { AiError, aiConfigured } from "@/lib/server/ai";
import { logQuery } from "@/lib/server/analytics";
import { CORS_HEADERS, json, preflight } from "@/lib/server/cors";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const bodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).min(1).max(20),
  lang: z.enum(["ru", "ba"]).optional(),
});

/** POST /api/ai/chat — ИИ-агент: свободный запрос → уточнение или подборка с объяснением. */
export async function POST(request: Request) {
  if (!(await aiConfigured())) return json({ error: "ai_disabled" }, { status: 503 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "bad_request" }, { status: 400 });

  // Лимит на адрес: защищает токены GigaChat и очередь от скриптов
  const limited = await rateLimit(`ai:${clientIp(request)}`, "ip");
  if (limited) {
    return json({ error: "rate_limited", message: limited.message }, { status: 429, headers: { ...CORS_HEADERS, "Retry-After": String(limited.retryAfterSec) } });
  }

  try {
    const reply = await runAgent(body.data.messages, { lang: body.data.lang });
    const last = body.data.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
    logQuery(request.headers.get("x-afisha-client") === "site" ? "site" : "api", last, reply);
    return json(reply);
  } catch (e) {
    if (e instanceof AiError) return json({ error: "ai_error", message: e.message }, { status: 502 });
    throw e;
  }
}
