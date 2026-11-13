import { SAMPLE_JSON } from "@/lib/format-spec";

/** Образец ленты в универсальном формате (JSON). */
export function GET() {
  return new Response(SAMPLE_JSON, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
