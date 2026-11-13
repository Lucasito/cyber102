import { apiRoute, cachedJson } from "@/lib/server/api";
import { apiError, preflight } from "@/lib/server/cors";
import { parseEventFilter, searchEvents } from "@/lib/server/events";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** GET /api/v1/events — поиск событий с фильтрами, пагинацией и сортировкой (см. /api/v1/openapi). */
export const GET = apiRoute("GET /api/v1/events", async (request) => {
  const parsed = parseEventFilter(new URL(request.url).searchParams);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({ param: i.path.join("."), problem: i.message }));
    return apiError(400, "bad_request", "Неверные параметры запроса", details);
  }
  return cachedJson(request, await searchEvents(parsed.data), 30);
});
