import "server-only";

// Базовые метрики (ТЗ 6.3 «Наблюдаемость»): запросы, ошибки, задержка — по маршрутам API, в памяти процесса
// (один контейнер; при нескольких экземплярах — Prometheus/общее хранилище). Выдаёт GET /api/metrics.

type RouteStats = { requests: number; errors4xx: number; errors5xx: number; latencies: number[] };

const routes = new Map<string, RouteStats>();
const WINDOW = 1000; // последние N задержек на маршрут — для перцентилей

export function recordRequest(route: string, status: number, ms: number) {
  const s = routes.get(route) ?? { requests: 0, errors4xx: 0, errors5xx: 0, latencies: [] };
  s.requests++;
  if (status >= 500) s.errors5xx++;
  else if (status >= 400) s.errors4xx++;
  s.latencies.push(ms);
  if (s.latencies.length > WINDOW) s.latencies.shift();
  routes.set(route, s);
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
}

export function metricsSnapshot() {
  const all = [...routes.values()];
  const latencies = all.flatMap((s) => s.latencies);
  return {
    uptimeSec: Math.round(process.uptime()),
    requests: all.reduce((n, s) => n + s.requests, 0),
    errors4xx: all.reduce((n, s) => n + s.errors4xx, 0),
    errors5xx: all.reduce((n, s) => n + s.errors5xx, 0),
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: latencies.length ? Math.round(Math.max(...latencies)) : null },
    routes: Object.fromEntries(
      [...routes.entries()].map(([route, s]) => [route, { requests: s.requests, errors4xx: s.errors4xx, errors5xx: s.errors5xx, p50: percentile(s.latencies, 50), p95: percentile(s.latencies, 95) }]),
    ),
  };
}
