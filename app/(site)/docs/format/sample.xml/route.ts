import { SAMPLE_RSS } from "@/lib/format-spec";

/** Образец ленты в универсальном формате (RSS 2.0 с полями afisha:). */
export function GET() {
  return new Response(SAMPLE_RSS, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
