import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock, FeedChecker } from "@/components/format-tools";
import { FORMAT_FIELDS, SAMPLE_JSON, SAMPLE_RSS } from "@/lib/format-spec";

export const metadata: Metadata = {
  title: "Как разместить афишу учреждения",
  description: "Универсальный формат ленты событий для учреждений культуры Башкортостана: JSON или RSS, примеры и проверка.",
};

const STEPS = [
  { n: 1, title: "Опубликуйте ленту", text: "Файл JSON или RSS на вашем сайте со списком будущих событий. Обычно это одна страница, которую сайт обновляет сам." },
  { n: 2, title: "Проверьте здесь", text: "Вставьте адрес ниже — увидите, какие события попадут в афишу и что поправить." },
  { n: 3, title: "Пришлите адрес", text: "Модератор подключит ленту. Дальше новые события, переносы и отмены появляются в афише сами." },
];

const OPTIONS = [
  { title: "JSON", badge: "рекомендуем", text: "Для сайтов на собственном движке и для разработчиков. Простой список событий с понятными полями." },
  { title: "RSS с полями afisha:", text: "Если сайт уже отдаёт RSS (WordPress, Битрикс). В каждую запись добавляются поля с датой, площадкой и ценой." },
  { title: "Разметка schema.org", text: "Если на страницах событий уже есть разметка Event для поисковиков — подойдёт и она." },
  { title: "Нет ни ленты, ни разработчика", text: "Добавляйте события по одному или файлом Excel/CSV в кабинете организатора — после проверки модератором они в афише." },
];

export default function FormatPage() {
  const base = process.env.PUBLIC_URL ?? "";
  return (
    <main className="mx-auto max-w-3xl px-4 pt-10 pb-16">
      <h1 className="text-3xl font-semibold tracking-tight">Как разместить афишу учреждения</h1>
      <p className="mt-3 text-stone-600">
        Афиша культуры Башкортостана собирает события театров, музеев, филармоний и домов культуры республики. Они показываются на сайте, в ботах MAX и Telegram, в
        виджетах на сторонних сайтах и в ответах умного помощника. Размещение бесплатное. Чтобы не вводить события вручную, опубликуйте ленту в универсальном
        формате.
      </p>

      <ol className="mt-8 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-2xl bg-white p-4 ring-1 ring-black/10">
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--brand)] text-sm font-semibold text-white">{s.n}</span>
            <p className="mt-2 font-medium">{s.title}</p>
            <p className="mt-1 text-sm text-stone-600">{s.text}</p>
          </li>
        ))}
      </ol>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">Какой вариант выбрать</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((o) => (
            <div key={o.title} className="rounded-2xl bg-white p-4 ring-1 ring-black/10">
              <p className="font-medium">
                {o.title}
                {o.badge && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-normal text-emerald-800">{o.badge}</span>}
              </p>
              <p className="mt-1 text-sm text-stone-600">{o.text}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-stone-500">
          Обычную RSS-ленту новостей мы тоже можем читать — карточки разбирает ИИ, и каждое событие проверяет модератор. Это медленнее и менее точно, чем лента в
          универсальном формате.
        </p>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">Поля события</h2>
        <p className="text-stone-600">
          Обязательных полей пять: название, начало, город, площадка и ссылка на страницу события. Остальные делают карточку полезнее — цена, возраст, билеты.
        </p>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-2 pr-3 font-normal">Поле</th>
                <th className="py-2 pr-3 font-normal">Формат</th>
                <th className="py-2 pr-3 font-normal">Что это</th>
              </tr>
            </thead>
            <tbody>
              {FORMAT_FIELDS.map((f) => (
                <tr key={f.name} className="border-t border-black/5 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <code className="font-medium">{f.name}</code>
                    {f.required && <span className="ml-1 text-xs text-red-700">обязательно</span>}
                  </td>
                  <td className="py-2 pr-3 text-stone-600">
                    {f.type}
                    <div className="text-xs text-stone-400">{f.example}</div>
                  </td>
                  <td className="py-2 pr-3 text-stone-600">{f.about}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">Пример: JSON</h2>
        <p className="text-stone-600">
          Массив событий или объект <code>{"{ \"events\": [...] }"}</code>. Кодировка UTF-8. Образец:{" "}
          <a href="/docs/format/sample.json" className="font-medium text-[var(--brand)] hover:underline">
            {base}/docs/format/sample.json
          </a>
        </p>
        <CodeBlock code={SAMPLE_JSON} label="пример JSON" />
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">Пример: RSS с полями afisha:</h2>
        <p className="text-stone-600">
          Обычный RSS 2.0 плюс пространство имён <code>xmlns:afisha=&quot;urn:afisha-rb:1&quot;</code>. Название — в <code>title</code>, ссылка на страницу события — в{" "}
          <code>link</code>, постоянный код — в <code>guid</code>, остальные поля — элементами <code>afisha:имя</code>. Образец:{" "}
          <a href="/docs/format/sample.xml" className="font-medium text-[var(--brand)] hover:underline">
            {base}/docs/format/sample.xml
          </a>
        </p>
        <CodeBlock code={SAMPLE_RSS} label="пример RSS" />
      </section>

      <section className="mt-10 space-y-2">
        <h2 className="text-xl font-semibold">Правила</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-stone-600">
          <li>В ленте — будущие события; прошедшие можно не удалять, они пропускаются.</li>
          <li>Время — местное (Уфа, UTC+5), если часовой пояс не указан. Удобнее всего — ISO 8601 с поясом: 2027-03-14T19:00:00+05:00.</li>
          <li>
            <code>externalId</code> (или <code>guid</code> в RSS) не меняйте: по нему перенос даты обновит событие, а не создаст второе.
          </li>
          <li>
            Отменили — не удаляйте запись, а поставьте <code>status: cancelled</code>: так зрители узнают об отмене. Перенесли — новая дата и{" "}
            <code>status: rescheduled</code>.
          </li>
          <li>У каждого сеанса — своя запись. Выставка — одна запись с датой окончания.</li>
          <li>Только события в Башкортостане. Ссылка в sourceUrl должна открываться — мы проверяем её при каждом сборе.</li>
          <li>Ленту мы читаем несколько раз в сутки. Повторная загрузка без изменений ничего не меняет.</li>
        </ul>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">Проверить ленту</h2>
        <p className="text-stone-600">Ничего не сохраняется — проверка показывает, как события попадут в афишу.</p>
        <FeedChecker />
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">Подключение</h2>
        <p className="text-stone-600">
          Пришлите адрес ленты через{" "}
          <Link href="/feedback?kind=organizer" className="font-medium text-[var(--brand)] hover:underline">
            форму для организаторов
          </Link>{" "}
          — модератор проверит её и подключит. Там же можно попросить доступ в кабинет организатора, чтобы добавлять события вручную или файлом.
        </p>
        <p className="text-sm text-stone-500">
          Проверка доступна и через API: <code>POST /api/v1/format/check</code> с телом <code>{"{ \"url\": \"…\" }"}</code> или <code>{"{ \"content\": \"…\" }"}</code> —{" "}
          <Link href="/docs" className="underline">
            документация API
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
