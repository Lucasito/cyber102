import { apiRoute, cachedJson } from "@/lib/server/api";
import { apiError, preflight } from "@/lib/server/cors";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** GET /api/v1/events/{id} — карточка события с площадкой, категорией и источниками. Черновики не выдаются. */
export const GET = apiRoute<{ id: string }>("GET /api/v1/events/{id}", async (request, { params }) => {
  const { id } = await params;
  const event = await db.event.findFirst({ where: { id, publication: "PUBLISHED" }, include: { venue: true, category: true, sources: true } });
  return event ? cachedJson(request, event, 60) : apiError(404, "not_found", "Событие не найдено");
});
