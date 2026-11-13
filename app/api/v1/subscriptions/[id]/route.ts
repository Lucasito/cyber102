import { timingSafeEqual } from "node:crypto";
import { apiRoute } from "@/lib/server/api";
import { apiError, json, preflight } from "@/lib/server/cors";
import { db } from "@/lib/server/db";
import { searchEvents } from "@/lib/server/events";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Подписка по id и ключу (?key= или заголовок X-Subscription-Key); неверный ключ — как несуществующая. */
async function bySecret(request: Request, id: string) {
  const key = new URL(request.url).searchParams.get("key") ?? request.headers.get("x-subscription-key") ?? "";
  const sub = await db.subscription.findUnique({ where: { id } });
  if (!sub?.secret || sub.secret.length !== key.length || !timingSafeEqual(Buffer.from(sub.secret), Buffer.from(key))) return null;
  return sub;
}

/** GET /api/v1/subscriptions/{id}?key= — лента: актуальные события подписки, сначала недавно добавленные (до 50). */
export const GET = apiRoute<{ id: string }>("GET /api/v1/subscriptions/{id}", async (request, { params }) => {
  const sub = await bySecret(request, (await params).id);
  if (!sub) return apiError(404, "not_found", "Подписка не найдена");
  const { items } = await searchEvents({ city: sub.city ?? undefined, category: sub.category ?? undefined, sort: "new", limit: 50, offset: 0 });
  return json({ id: sub.id, city: sub.city, category: sub.category, createdAt: sub.createdAt, items });
});

/** DELETE /api/v1/subscriptions/{id}?key= — отписка: запись удаляется. */
export const DELETE = apiRoute<{ id: string }>("DELETE /api/v1/subscriptions/{id}", async (request, { params }) => {
  const sub = await bySecret(request, (await params).id);
  if (!sub) return apiError(404, "not_found", "Подписка не найдена");
  await db.subscription.delete({ where: { id: sub.id } });
  return new Response(null, { status: 204 });
});
