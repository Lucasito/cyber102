import { apiRoute, cachedJson } from "@/lib/server/api";
import { preflight } from "@/lib/server/cors";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** GET /api/v1/cities — справочник городов: название, площадок, актуальных событий. */
export const GET = apiRoute("GET /api/v1/cities", async (request) => {
  const venues = await db.venue.findMany({
    select: { city: true, _count: { select: { events: { where: { publication: "PUBLISHED", status: { notIn: ["PAST", "CANCELLED"] } } } } } },
  });
  const byCity = new Map<string, { name: string; venues: number; events: number }>();
  for (const v of venues) {
    const c = byCity.get(v.city) ?? { name: v.city, venues: 0, events: 0 };
    c.venues++;
    c.events += v._count.events;
    byCity.set(v.city, c);
  }
  return cachedJson(request, { items: [...byCity.values()].sort((a, b) => b.events - a.events || a.name.localeCompare(b.name, "ru")) }, 300);
});
