import { apiRoute } from "@/lib/server/api";
import { apiError, json, preflight } from "@/lib/server/cors";
import { feedbackSchema, saveFeedback, spamCheck } from "@/lib/server/feedback";
import { clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/**
 * POST /api/v1/feedback — обращение: заявка организатора, уточнение по событию или вопрос.
 * Тело: { kind: organizer|correction|question, message, eventId?, name?, contact? }. Ответ 201: { id, status }.
 */
export const POST = apiRoute("POST /api/v1/feedback", async (request) => {
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const body = feedbackSchema.safeParse(raw);
  if (!body.success) {
    const details = body.error.issues.map((i) => ({ param: i.path.join("."), problem: i.message }));
    return apiError(400, "bad_request", "Неверное тело запроса", details);
  }
  const spam = spamCheck(clientIp(request), { honeypot: typeof raw?.website === "string" ? raw.website : undefined, message: body.data.message });
  if (spam) return apiError(429, "rate_limited", spam === "spam" ? "Обращение отклонено" : spam);
  const fb = await saveFeedback(body.data, "api");
  return json({ id: fb.id, status: "received" }, { status: 201 });
});
