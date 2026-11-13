import "server-only";

// Открытый API: читать может любой сайт (виджет, сайт министерства)
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, { ...init, headers: { ...CORS_HEADERS, ...init.headers } });
}

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });
