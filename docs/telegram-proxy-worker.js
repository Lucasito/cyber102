// Cloudflare Worker — зеркало API Telegram для бота афиши.
// Зачем: с сервера в РФ api.telegram.org заблокирован в обе стороны,
// а Cloudflare доступен. Сервер опрашивает Telegram через этот воркер.
//
// Установка (бесплатный тариф Cloudflare, ~5 минут):
//   1. dash.cloudflare.com → Workers & Pages → Create → Create Worker → имя, например afisha-tg → Deploy.
//   2. Edit code → вставить этот файл целиком → Deploy.
//   3. Адрес воркера (https://afisha-tg.<ваш-аккаунт>.workers.dev) → админка → «Бот Telegram»:
//      «Адрес API Telegram» = этот адрес, «Режим» = «Опрос», Сохранить, «Проверить бота».
//
// Пропускает только запросы нашего бота (по id из токена) — открытым прокси воркер не станет.

const ALLOWED_BOT_IDS = ["9043666244"]; // @AfishaBashBot; id — часть токена до двоеточия, не секрет

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/(bot|file\/bot)(\d+):[\w-]+\//);
    if (!match || !ALLOWED_BOT_IDS.includes(match[2])) return new Response("Not found", { status: 404 });

    const target = new URL(url.pathname + url.search, "https://api.telegram.org");
    const init = { method: request.method, headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/json" } };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();
    const res = await fetch(target, init);
    return new Response(res.body, { status: res.status, headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" } });
  },
};
