import { json, preflight } from "@/lib/server/cors";

export const OPTIONS = preflight;

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
  ["sort", "string", "date (по дате, по умолчанию) | price_asc (сначала бесплатные и дешёвые) | price_desc (сначала дорогие) | new (недавно добавленные) | distance (ближе к точке near)"],
  ["limit", "integer", "1–100, по умолчанию 20"],
  ["offset", "integer", "Смещение для постраничной выдачи"],
] as const;

/** OpenAPI 3.1 — открытая документация API для сайта министерства и сторонних разработчиков. */
export function GET(request: Request) {
  const origin = process.env.PUBLIC_URL || new URL(request.url).origin;
  return json({
    openapi: "3.1.0",
    info: { title: "Афиша культуры Башкортостана — API", version: "1.0.0", description: "Открытый API достоверной афиши культурных событий Республики Башкортостан." },
    servers: [{ url: origin }],
    paths: {
      "/api/v1/events": {
        get: {
          summary: "Поиск событий",
          parameters: eventParams.map(([name, type, description]) => ({ name, in: "query", schema: { type }, description })),
          responses: { "200": { description: "Список событий: { items, total, limit, offset }" }, "400": { description: "Неверные параметры" } },
        },
      },
      "/api/v1/events/{id}": {
        get: {
          summary: "Событие по id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Событие с площадкой, категорией и источниками" }, "404": { description: "Не найдено" } },
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
          responses: { "200": { description: "{ text, eventIds, filter? } — уточняющий вопрос или подборка с объяснением" } },
        },
      },
    },
  });
}
