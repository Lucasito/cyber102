import { z } from "zod";
import { apiRoute } from "@/lib/server/api";
import { detectRows } from "@/lib/server/collect/detect";
import { fetchText } from "@/lib/server/collect/fetch";
import { apiError, json, preflight } from "@/lib/server/cors";
import { validateRows } from "@/lib/server/import";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const bodySchema = z.union([z.object({ url: z.string().trim().url().max(1000) }), z.object({ content: z.string().min(2).max(3_000_000) })]);

const HINTS = {
  json: "Лента в универсальном формате JSON — подключается без ИИ.",
  rss: "Лента RSS с полями afisha: — подключается без ИИ.",
  rss_plain: "Это обычная RSS-лента без полей afisha:. Её можно подключить с разбором карточек ИИ (через модерацию), но надёжнее добавить поля из универсального формата.",
  jsonld: "Страница с разметкой schema.org Event — подключается без ИИ.",
  unknown: "Формат не распознан.",
} as const;

/**
 * POST /api/v1/format/check — проверка ленты в универсальном формате: { url } или { content }.
 * Ничего не сохраняет. Ответ: формат, сколько записей, как каждая пройдёт импорт (до 200 строк).
 */
export const POST = apiRoute("POST /api/v1/format/check", async (request) => {
  const limited = await rateLimit(`format:${clientIp(request)}`, "ip");
  if (limited) return apiError(429, "rate_limited", limited.message, { retryAfterSec: limited.retryAfterSec }, { "Retry-After": String(limited.retryAfterSec) });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError(400, "bad_request", "Нужен { url } — адрес ленты — или { content } — её текст");
  let text: string;
  let url = "";
  if ("url" in body.data) {
    url = body.data.url;
    try {
      text = (await fetchText(url)).text;
    } catch (e) {
      return apiError(422, "fetch_failed", `Не удалось загрузить ленту: ${e instanceof Error ? e.message : e}`);
    }
  } else text = body.data.content;
  const d = detectRows(text, url);
  const rows = await validateRows(d.rows);
  return json({
    format: d.format,
    hint: d.error ?? HINTS[d.format],
    items: d.items,
    events: rows.length,
    ok: rows.filter((r) => r.ok).length,
    withIssues: rows.filter((r) => r.ok && r.issues.length).length,
    rows: rows.slice(0, 200),
  });
});
