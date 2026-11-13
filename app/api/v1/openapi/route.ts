import { json, preflight } from "@/lib/server/cors";

export const OPTIONS = preflight;

/** Ответ с ошибкой — ссылка на общую схему Error. */
const err = (description: string, example: { code: string; message: string; details?: unknown }) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example } },
});

const eventParams = [
  ["q", "string", "Поиск по названию и описанию"],
  ["city", "string", "Город (Уфа, Стерлитамак, …)"],
  ["category", "string", "Код категории: theatre, concert, museum, exhibition, kids …"],
  ["dateFrom", "string", "С даты (ISO 8601). По умолчанию — сейчас"],
  ["dateTo", "string", "По дату (ISO 8601)"],
  ["priceMax", "integer", "Минимальная цена билета не выше, ₽"],
  ["free", "boolean", "Только бесплатные"],
  ["age", "integer", "Возраст зрителя: события с ограничением не выше"],
  ["status", "string", "SCHEDULED | RESCHEDULED | CANCELLED | SOLD_OUT | PAST"],
  ["pushkin", "boolean", "Только события, которые можно оплатить Пушкинской картой"],
  ["access", "string", "Доступная среда: wheelchair (на коляске) | hearing (для слабослышащих) | vision (для слабовидящих)"],
  ["near", "string", "Рядом с точкой: «широта,долгота», например 54.7348,55.9579. В ответе — distanceKm"],
  ["radius", "number", "Радиус для near, км (1–300, по умолчанию 15)"],
  [
    "sort",
    "string",
    "date (по дате, по умолчанию) | price_asc (сначала бесплатные и дешёвые) | price_desc (сначала дорогие) | new (недавно добавленные) | distance (ближе к точке near)",
  ],
  ["limit", "integer", "1–100, по умолчанию 20"],
  ["offset", "integer", "Смещение для постраничной выдачи"],
] as const;

/** OpenAPI 3.1 — открытая документация API для сторонних сайтов и приложений (в т. ч. для встраивания на сайт министерства). */
export function GET(request: Request) {
  const origin = process.env.PUBLIC_URL || new URL(request.url).origin;
  return json({
    openapi: "3.1.0",
    info: {
      title: "Афиша культуры Башкортостана — API",
      version: "1.0.0",
      description:
        "Открытый API афиши культурных событий Республики Башкортостан. Неофициальный сервис: не является сервисом Министерства культуры РБ. " +
        "У каждого события есть ссылка на источник. Ошибки — в едином формате { code, message, details }. " +
        "Каждый ответ содержит X-Request-Id (можно передать свой) — по нему ищется запрос в логах. " +
        "Справочники и карточки кешируются: ETag + Cache-Control, повторный запрос с If-None-Match получает 304.",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/v1/events": {
        get: {
          summary: "Поиск событий",
          parameters: eventParams.map(([name, type, description]) => ({ name, in: "query", schema: { type }, description })),
          responses: {
            "200": { description: "Список событий: { items, total, limit, offset }" },
            "400": err("Неверные параметры", {
              code: "bad_request",
              message: "Неверные параметры запроса",
              details: [{ param: "age", problem: "Too big: expected number to be <=18" }],
            }),
          },
        },
      },
      "/api/v1/events/{id}": {
        get: {
          summary: "Событие по id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Событие с площадкой, категорией и источниками" },
            "404": err("Не найдено", { code: "not_found", message: "Событие не найдено" }),
          },
        },
      },
      "/api/v1/cities": {
        get: { summary: "Справочник городов", description: "Кеш: ETag, Cache-Control 300 с.", responses: { "200": { description: "{ items: [{ name, venues, events }] }" } } },
      },
      "/api/v1/venues": {
        get: {
          summary: "Справочник площадок",
          parameters: [{ name: "city", in: "query", schema: { type: "string" }, description: "Только площадки города" }],
          responses: { "200": { description: "{ items: [{ id, name, city, address, lat, lon, events }] }" } },
        },
      },
      "/api/v1/categories": {
        get: { summary: "Справочник категорий", description: "code — значение для фильтра category.", responses: { "200": { description: "{ items: [{ code, name, events }] }" } } },
      },
      "/api/v1/feedback": {
        post: {
          summary: "Обращение: заявка организатора, уточнение по событию, вопрос",
          requestBody: {
            content: {
              "application/json": {
                example: { kind: "correction", eventId: "…", message: "Концерт перенесён на 20 декабря, см. сайт филармонии", contact: "необязательно — для ответа" },
              },
            },
          },
          responses: {
            "201": { description: "{ id, status: received }" },
            "400": err("Неверное тело", { code: "bad_request", message: "Неверное тело запроса", details: [{ param: "message", problem: "Опишите подробнее — не меньше 10 символов" }] }),
            "429": err("Лимит обращений с адреса", { code: "rate_limited", message: "Слишком много обращений с вашего адреса — попробуйте через час." }),
          },
        },
      },
      "/api/v1/subscriptions": {
        post: {
          summary: "Подписка на новые события города и категории",
          description: "Без персональных данных: в ответе ключ key — лента и отписка доступны только с ним.",
          requestBody: { content: { "application/json": { example: { city: "Уфа", category: "concert" } } } },
          responses: { "201": { description: "{ id, key, city, category, feedUrl, unsubscribe }" }, "400": err("Неизвестная категория", { code: "bad_request", message: "Неизвестная категория — коды в /api/v1/categories" }) },
        },
      },
      "/api/v1/plan": {
        get: {
          summary: "Планировщик «Выходной день»: 2–4 события на день",
          description:
            "События по времени, без пересечений, с переездами (по прямой, 20 км/ч + 10 мин) и общей стоимостью (минимальная цена × число людей). " +
            "Выставки и музеи — в свободное время 10:00–18:00, посещение 90 мин. Несовместимые условия — ok: false и violations: какое условие мешает и минимальная правка.",
          parameters: [
            { name: "date", in: "query", schema: { type: "string", format: "date" }, description: "День (по умолчанию ближайшая суббота)" },
            { name: "city", in: "query", schema: { type: "string", default: "Уфа" } },
            { name: "budget", in: "query", schema: { type: "integer" }, description: "Бюджет на всех, ₽" },
            { name: "persons", in: "query", schema: { type: "integer", default: 1 } },
            { name: "age", in: "query", schema: { type: "integer" }, description: "Возраст младшего участника" },
            { name: "from", in: "query", schema: { type: "string", default: "10:00" }, description: "Начало свободного окна, HH:MM" },
            { name: "to", in: "query", schema: { type: "string", default: "22:00" }, description: "Конец свободного окна, HH:MM" },
            { name: "maxTravelMin", in: "query", schema: { type: "integer", default: 40 }, description: "Предел одного переезда, мин" },
            { name: "count", in: "query", schema: { type: "integer", minimum: 2, maximum: 4, default: 3 } },
          ],
          responses: {
            "200": {
              description:
                "{ ok: true, input, items: [{ event, start, end, flexible, travelMin, cost }], totalCost, unknownPrice, travelMin, note } или { ok: false, input, violations: [{ constraint, message, fix }], best }",
            },
            "400": err("Неверные параметры", { code: "bad_request", message: "Неверные параметры плана", details: [{ param: "date", problem: "Invalid string" }] }),
          },
        },
      },
      "/api/v1/subscriptions/{id}": {
        get: {
          summary: "Лента подписки: актуальные события, сначала недавно добавленные",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "key", in: "query", required: true, schema: { type: "string" }, description: "Ключ из ответа POST (или заголовок X-Subscription-Key)" },
          ],
          responses: { "200": { description: "{ id, city, category, createdAt, items }" }, "404": err("Нет подписки или неверный ключ", { code: "not_found", message: "Подписка не найдена" }) },
        },
        delete: {
          summary: "Отписаться: подписка удаляется",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "key", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { "204": { description: "Удалено" }, "404": err("Нет подписки или неверный ключ", { code: "not_found", message: "Подписка не найдена" }) },
        },
      },
      "/api/ai/chat": {
        post: {
          summary: "ИИ-агент: подбор событий по свободному запросу",
          requestBody: {
            content: {
              "application/json": {
                example: { messages: [{ role: "user", content: "куда пойти в субботу с ребёнком до 1000 рублей" }] },
              },
            },
          },
          responses: {
            "200": {
              description:
                "{ text, events, filter?, suggestions, clarify?, relaxed?, degraded?, traceId? } — уточняющий вопрос или подборка с объяснением. degraded: true — ИИ недоступен или исчерпан лимит стоимости, ответ собран обычным поиском (резервный режим). traceId — трасса ответа для разбора в админке",
            },
            "400": err("Неверное тело запроса", { code: "bad_request", message: "Неверное тело запроса: нужен { messages: [{ role, content }] }" }),
            "429": err("Слишком много запросов (заголовок Retry-After)", {
              code: "rate_limited",
              message: "Слишком много запросов подряд — подождите 30 с.",
              details: { retryAfterSec: 30 },
            }),
          },
        },
      },
    },
    components: {
      schemas: {
        Error: {
          type: "object",
          required: ["code", "message"],
          properties: {
            code: { type: "string", description: "Машинный код: bad_request, not_found, rate_limited, ai_error" },
            message: { type: "string", description: "Понятное человеку описание" },
            details: { description: "Подробности: неверные параметры, время ожидания и т. п." },
          },
        },
      },
    },
  });
}
