import { z } from "zod";
import { runAgent } from "@/lib/server/agent";
import { AiError } from "@/lib/server/ai";
import { apiRoute } from "@/lib/server/api";
import { apiError, json, preflight } from "@/lib/server/cors";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const bodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).min(1).max(20),
  lang: z.enum(["ru", "ba"]).optional(),
});

/** POST /api/ai/chat — ИИ-агент: свободный запрос → уточнение или подборка с объяснением. */
export const POST = apiRoute("POST /api/ai/chat", async (request) => {
  // ИИ не настроен или недоступен — агент всё равно отвечает: правила + шаблон (резервный режим, ТЗ 7.5)
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    const details = body.error?.issues.map((i) => ({ param: i.path.join("."), problem: i.message }));
    return apiError(400, "bad_request", "Неверное тело запроса: нужен { messages: [{ role, content }] }", details);
  }

  // Лимит на адрес: защищает токены GigaChat и очередь от скриптов
  const limited = await rateLimit(`ai:${clientIp(request)}`, "ip");
  if (limited) {
    return apiError(429, "rate_limited", limited.message, { retryAfterSec: limited.retryAfterSec }, { "Retry-After": String(limited.retryAfterSec) });
  }

  try {
    const reply = await runAgent(body.data.messages, {
      lang: body.data.lang,
      source: request.headers.get("x-afisha-client") === "site" ? "site" : "api",
      userKey: `ip:${clientIp(request)}`,
    });
    return json(reply);
  } catch (e) {
    if (e instanceof AiError) return apiError(502, "ai_error", e.message);
    throw e;
  }
});
