import { apiRoute, cachedJson } from "@/lib/server/api";
import { preflight } from "@/lib/server/cors";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** GET /api/v1/categories — справочник категорий: код (для фильтра category), название, актуальных событий. */
export const GET = apiRoute("GET /api/v1/categories", async (request) => {
  const cats = await db.category.findMany({
    orderBy: { name: "asc" },
    select: { slug: true, name: true, _count: { select: { events: { where: { publication: "PUBLISHED", status: { notIn: ["PAST", "CANCELLED"] } } } } } },
  });
  return cachedJson(request, { items: cats.map((c) => ({ code: c.slug, name: c.name, events: c._count.events })) }, 300);
});
