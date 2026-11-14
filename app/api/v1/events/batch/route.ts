import { apiRoute, cachedJson } from "@/lib/server/api";
import { apiError, preflight } from "@/lib/server/cors";
import { db } from "@/lib/server/db";
import { EVENT_ID, MAX_FAVORITES } from "@/lib/favorites";
import { toCard } from "@/lib/format";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Только чтение публичных карточек по ID. Избранное и профиль пользователя на сервере не сохраняются. */
export const GET = apiRoute("GET /api/v1/events/batch", async (request) => {
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = raw ? raw.split(",") : [];
  if (ids.length > MAX_FAVORITES || ids.some((id) => !EVENT_ID.test(id))) return apiError(400, "bad_request", "Ожидается не больше 100 идентификаторов событий через запятую.");
  const unique = [...new Set(ids)];
  const events = unique.length ? await db.event.findMany({ where: { id: { in: unique }, publication: "PUBLISHED" }, include: { venue: true, category: true } }) : [];
  const found = new Set(events.map((e) => e.id));
  return cachedJson(request, { items: events.map((e) => ({ ...toCard(e), venue: e.venue ? { name: e.venue.name, city: e.venue.city, address: e.venue.address } : null })), missing: unique.filter((id) => !found.has(id)) }, 30);
});
