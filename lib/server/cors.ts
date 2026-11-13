import "server-only";

// Открытый API: читать может любой сайт (виджет, сайт министерства)
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match, X-Request-Id, X-Subscription-Key",
  "Access-Control-Expose-Headers": "X-Request-Id, ETag, Retry-After",
};

export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, { ...init, headers: { ...CORS_HEADERS, ...init.headers } });
}

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });

/**
 * Ошибка API в едином формате (ТЗ 6.3): { code, message, details? } и правильный HTTP-код.
 * code — машинный код, message — понятный человеку текст, details — подробности (например, какие параметры неверны).
 */
export function apiError(status: number, code: string, message: string, details?: unknown, headers?: HeadersInit) {
  return json(details === undefined ? { code, message } : { code, message, details }, { status, headers: { ...CORS_HEADERS, ...headers } });
}
