import { apiRoute, cachedJson } from "@/lib/server/api";
import { preflight } from "@/lib/server/cors";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** GET /api/v1/venues?city= — справочник площадок: название, город, адрес, координаты, актуальных событий. */
export const GET = apiRoute("GET /api/v1/venues", async (request) => {
  const city = new URL(request.url).searchParams.get("city")?.trim().slice(0, 100);
  const venues = await db.venue.findMany({
    where: city ? { city: { equals: city, mode: "insensitive" } } : {},
    orderBy: [{ city: "asc" }, { name: "asc" }],
    select: { id: true, name: true, city: true, address: true, lat: true, lon: true, _count: { select: { events: { where: { publication: "PUBLISHED", status: { notIn: ["PAST", "CANCELLED"] } } } } } },
  });
  return cachedJson(request, { items: venues.map(({ _count, ...v }) => ({ ...v, events: _count.events })) }, 300);
});
