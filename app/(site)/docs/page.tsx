import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "API и виджет" };

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-2xl bg-stone-900 p-4 text-sm leading-relaxed text-stone-100">{children}</pre>;
}

export default function Docs() {
  const base = process.env.PUBLIC_URL ?? "";
  return (
    <main className="mx-auto max-w-3xl px-4 pt-10 pb-16">
      <h1 className="text-3xl font-semibold tracking-tight">API и виджет</h1>
      <p className="mt-3 text-stone-600">
        Афиша открыта для сайтов и приложений: REST API без ключа и виджет, который встраивается одной строкой и не затрагивает работу сайта.
      </p>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">Виджет</h2>
        <p className="text-stone-600">
          Вставьте код в нужное место страницы. Виджет работает во фрейме — стили и скрипты сайта не меняются. Город, период, вид, цвет и другие настройки удобно
          выбрать в{" "}
          <Link href="/docs/widget" className="font-medium text-[var(--brand)] underline-offset-2 hover:underline">
            конструкторе виджета
          </Link>{" "}
          — он сразу покажет результат и готовый код.
        </p>
        <Code>{`<div data-afisha-widget data-city="Уфа" data-limit="6"></div>
<script src="${base}/widget.js" async></script>`}</Code>
        <p className="text-sm text-stone-500">
          Атрибуты: <code>data-city</code>, <code>data-category</code>, <code>data-q</code>, <code>data-period</code> (today, tomorrow, weekend, week, month),{" "}
          <code>data-age</code>, <code>data-price-max</code>, <code>data-free</code>, <code>data-pushkin</code>, <code>data-sort</code>, <code>data-limit</code>,{" "}
          <code>data-layout</code> (grid, list), <code>data-title</code>, <code>data-accent</code> (цвет без #), <code>data-link=&quot;0&quot;</code>,{" "}
          <code>data-height</code> (число или auto).
        </p>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">REST API</h2>
        <p className="text-stone-600">
          Полная спецификация — <a className="text-[var(--brand)] underline underline-offset-2" href="/api/v1/openapi">OpenAPI 3.1</a>.
        </p>
        <Code>{`GET ${base}/api/v1/events?city=Уфа&dateFrom=2026-11-14&dateTo=2026-11-15&priceMax=1000&age=6
GET ${base}/api/v1/events/{id}`}</Code>
        <h3 className="pt-2 font-semibold">Умный поиск</h3>
        <Code>{`POST ${base}/api/ai/chat
{"messages": [{"role": "user", "content": "куда пойти в субботу с ребёнком до 1000 рублей"}]}`}</Code>
        <p className="text-sm text-stone-500">Ответ — пояснение помощника и события из афиши. Помощник выбирает только из базы и не выдумывает события.</p>
      </section>
    </main>
  );
}
