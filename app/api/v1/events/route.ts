import { json, preflight } from "@/lib/server/cors";
import { parseEventFilter, searchEvents } from "@/lib/server/events";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** GET /api/v1/events — поиск событий с фильтрами (см. /api/v1/openapi). */
export async function GET(request: Request) {
  const parsed = parseEventFilter(new URL(request.url).searchParams);
  if (!parsed.success) return json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  return json(await searchEvents(parsed.data));
}
