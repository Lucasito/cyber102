import type { MetadataRoute } from "next";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** Карта сайта для поисковиков: главная, документация API и актуальные события. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.PUBLIC_URL ?? "";
  const events = await db.event.findMany({
    where: { status: { not: "PAST" } },
    select: { id: true, updatedAt: true },
    orderBy: { startsAt: "asc" },
    take: 5000,
  });
  return [
    { url: `${base}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/docs`, changeFrequency: "monthly", priority: 0.3 },
    ...events.map((e) => ({ url: `${base}/events/${e.id}`, lastModified: e.updatedAt, changeFrequency: "daily" as const, priority: 0.7 })),
  ];
}
