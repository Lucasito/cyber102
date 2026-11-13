import { metricsSnapshot } from "@/lib/server/metrics";

export const dynamic = "force-dynamic";

/** GET /api/metrics — запросы, ошибки и задержка (p50/p95) по маршрутам API с момента запуска. */
export function GET() {
  return Response.json(metricsSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
