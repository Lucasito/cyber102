import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { apiError, CORS_HEADERS } from "./cors";
import { errMessage, log } from "./log";
import { recordRequest } from "./metrics";

// Обёртка маршрутов API: идентификатор запроса (X-Request-Id), структурный лог, метрики, ошибка 500 в едином
// формате вместо падения. Плюс ответы с кешированием (ETag / Cache-Control) для справочников и карточек.

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (request: Request, ctx: Ctx<P>, rid: string) => Promise<Response> | Response;

export function apiRoute<P = Record<string, never>>(route: string, handler: Handler<P>) {
  return async (request: Request, ctx: Ctx<P>) => {
    const rid = (request.headers.get("x-request-id") ?? "").replace(/[^\w-]/g, "").slice(0, 64) || randomUUID();
    const t0 = performance.now();
    let res: Response;
    try {
      res = await handler(request, ctx, rid);
    } catch (e) {
      log("error", "api_error", { rid, route, error: errMessage(e) });
      res = apiError(500, "internal", "Внутренняя ошибка сервиса. Попробуйте позже.", { requestId: rid });
    }
    const ms = performance.now() - t0;
    recordRequest(route, res.status, ms);
    log(res.status >= 500 ? "error" : "info", "api_request", { rid, route, method: request.method, status: res.status, ms: Math.round(ms) });
    const headers = new Headers(res.headers);
    headers.set("X-Request-Id", rid);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}

/**
 * JSON с кешированием (ТЗ 6.3): ETag по содержимому и Cache-Control. Совпал If-None-Match — 304 без тела.
 * maxAge — сколько секунд клиент и прокси могут не перезапрашивать; ещё столько же — отдавать устаревшее, обновляя в фоне.
 */
export function cachedJson(request: Request, data: unknown, maxAge: number) {
  const body = JSON.stringify(data);
  const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
  const headers = { ...CORS_HEADERS, ETag: etag, "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=${maxAge}`, "Content-Type": "application/json" };
  const inm = request.headers.get("if-none-match");
  if (inm && inm.split(",").some((t) => t.trim() === etag || t.trim() === `W/${etag}`)) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}
