import { randomBytes } from "node:crypto";
import { z } from "zod";
import { apiRoute } from "@/lib/server/api";
import { apiError, json, preflight } from "@/lib/server/cors";
import { db } from "@/lib/server/db";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const bodySchema = z.object({ city: z.string().trim().max(100).optional(), category: z.string().trim().max(50).optional() });

/**
 * POST /api/v1/subscriptions — подписка на новые события города и категории без персональных данных.
 * Ответ 201: { id, key, city, category, feedUrl, unsubscribe } — лента новых событий и отписка доступны только с key.
 */
export const POST = apiRoute("POST /api/v1/subscriptions", async (request) => {
  const body = bodySchema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!body.success) return apiError(400, "bad_request", "Неверное тело запроса", body.error.issues.map((i) => ({ param: i.path.join("."), problem: i.message })));
  const limited = await rateLimit(`sub:${clientIp(request)}`, "ip");
  if (limited) return apiError(429, "rate_limited", limited.message, { retryAfterSec: limited.retryAfterSec }, { "Retry-After": String(limited.retryAfterSec) });
  const category = body.data.category ? await db.category.findUnique({ where: { slug: body.data.category } }) : null;
  if (body.data.category && !category) return apiError(400, "bad_request", "Неизвестная категория — коды в /api/v1/categories", [{ param: "category", problem: "unknown" }]);
  const key = randomBytes(24).toString("base64url");
  const sub = await db.subscription.create({ data: { secret: key, city: body.data.city || null, category: category?.slug ?? null } });
  const base = process.env.PUBLIC_URL || new URL(request.url).origin;
  const feedUrl = `${base}/api/v1/subscriptions/${sub.id}?key=${key}`;
  return json({ id: sub.id, key, city: sub.city, category: sub.category, feedUrl, unsubscribe: { method: "DELETE", url: feedUrl } }, { status: 201 });
});
