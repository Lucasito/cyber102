import type { MetadataRoute } from "next";

// PUBLIC_URL известен только при запуске контейнера, не при сборке образа
export const dynamic = "force-dynamic";

/** robots.txt. Админку не упоминаем: она и так закрыта (404 без входа) и помечена noindex. */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.PUBLIC_URL ?? "";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/widget"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
