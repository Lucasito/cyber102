import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { fmtDateTime } from "@/components/admin/event-badges";
import { ImportForm } from "@/components/admin/import-form";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";

/** Наглядный пример для страницы: строки образца и что с ними сделает импорт. */
const SAMPLE: string[][] = [
  ["Вечер камерной музыки", "концерт", "2027-03-14 19:00", "Уфа", "Пример-зал", "от 300 до 800 ₽", "12+", "https://…/events/1", "", "Добавлено и опубликовано: цена 300–800 ₽, 12+"],
  ["Выставка графики", "выставка", "01.03.2027 10:00", "стерлитакмак", "Пример-галерея", "вход свободный", "0", "https://…/events/2", "", "Добавлено: город исправлен на «Стерлитамак», бесплатно"],
  ["Встреча с автором", "", "2027-03-17 18:00", "Уфа", "Библиотека", "", "", "https://…/events/7", "", "В модерацию: нет категории и цены — на сайте после проверки"],
  ["Отменённый концерт", "концерт", "2027-03-16 19:00", "Уфа", "Пример-зал", "600", "", "https://…/events/5", "отменено", "Добавлено как отменённое: в выдаче не показывается"],
  ["Гастроли", "концерт", "2027-03-18 19:00", "Казань", "Пример-зал", "500", "", "https://…/events/8", "", "Пропущено: вне Башкортостана"],
  ["Без источника", "концерт", "2027-03-15 19:00", "Уфа", "Пример-зал", "400", "", "", "", "Отклонено: нет ссылки на источник"],
];
const SAMPLE_CSV = [
  "title;category;date_start;city;venue;price;age_limit;source_url;status",
  ...SAMPLE.map((r) => r.slice(0, 9).map((c) => (c.includes(";") ? `"${c}"` : c)).join(";")),
].join("\n");

export default async function AdminImport() {
  await requireAdmin("MODERATOR");
  const runs = await db.importRun.findMany({ orderBy: { createdAt: "desc" }, take: 20, omit: { report: true } });
  return (
    <>
      <PageTitle
        title="Импорт событий"
        desc="Загрузка файла CSV или JSON. Повторная загрузка того же файла дублей не создаёт; одно событие из разных источников сводится в одну карточку; без категории или цены — в модерацию."
      />
      <Section>
        <ImportForm />
      </Section>
      <Section title="Как подготовить файл" desc="Таблица, сохранённая как CSV (Excel: «Файл → Сохранить как → CSV UTF-8»), или JSON. Одна строка — один сеанс: два показа в 14:00 и 18:00 — две строки.">
        <div className="space-y-5 text-sm">
          <div className="overflow-x-auto rounded-2xl ring-1 ring-black/5">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-100 text-stone-500">
                <tr>
                  {["title", "category", "date_start", "city", "venue", "price", "age_limit", "source_url", "status", "Что получится"].map((h) => (
                    <th key={h} className="px-2.5 py-2 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {SAMPLE.map((r) => (
                  <tr key={r[0]}>
                    {r.slice(0, 9).map((c, i) => (
                      <td key={i} className="px-2.5 py-2 whitespace-nowrap text-stone-700">
                        {c || <span className="text-stone-500">—</span>}
                      </td>
                    ))}
                    <td className="min-w-56 px-2.5 py-2 text-stone-600">{r[9]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 text-stone-600 sm:grid-cols-2">
            <p>
              <b className="text-stone-800">Обязательные колонки:</b> название (<code>title</code>), дата и время начала (<code>date_start</code>), город (
              <code>city</code>), площадка (<code>venue</code>), ссылка на источник (<code>source_url</code>). Без них строка отклоняется.
            </p>
            <p>
              <b className="text-stone-800">Желательные:</b> категория, цена, возраст, адрес, описание, окончание (<code>date_end</code>), длительность (
              <code>duration_min</code>), метки, язык, билеты (<code>ticket_url</code>), организатор, статус. Без категории или цены — карточка уходит в модерацию.
            </p>
            <p>
              <b className="text-stone-800">Как писать:</b> даты — <code>2027-03-14 19:00</code>, <code>14.03.2027 19:00</code> или «14 марта 2027 в 19:00» (местное
              время); цена — числом или текстом («вход свободный», «от 300 до 800 ₽»); возраст — <code>12</code> или <code>12+</code>; длительность — <code>120</code> или
              «2:00». Колонки можно называть и по-русски: название, дата, город, площадка, цена, источник.
            </p>
            <p>
              <b className="text-stone-800">Что делает импорт:</b> исправляет опечатки в городах («стерлитакмак» → Стерлитамак), пропускает события вне Башкортостана и
              прошедшие, сводит одно событие из разных источников в одну карточку. Повторная загрузка того же файла ничего не дублирует.
            </p>
          </div>
          <details>
            <summary className="cursor-pointer text-stone-600">Тот же пример в виде CSV</summary>
            <pre className="mt-2 overflow-x-auto rounded-2xl bg-stone-900 p-4 text-xs leading-relaxed text-stone-100">{SAMPLE_CSV}</pre>
          </details>
          <div className="flex flex-wrap gap-3">
            <a href="/admin/files/events-sample.csv" className="rounded-full bg-white px-4 py-2 font-medium ring-1 ring-black/10 hover:ring-black/30">
              Скачать образец CSV
            </a>
            <a href="/admin/files/events-sample.json" className="rounded-full bg-white px-4 py-2 font-medium ring-1 ring-black/10 hover:ring-black/30">
              Скачать образец JSON
            </a>
          </div>
        </div>
      </Section>
      <Section title="Последние загрузки">
        {runs.length ? (
          <ul className="divide-y divide-black/5 text-sm">
            {runs.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/import/${r.id}`} className="flex flex-wrap gap-x-4 gap-y-1 py-2 hover:bg-stone-50">
                  <span className="w-40 text-stone-500 tabular-nums">{fmtDateTime(r.createdAt)}</span>
                  <span className="min-w-0 flex-1 font-medium">
                    {r.fileName} <span className="font-normal text-stone-500">· {r.source} · {r.userLogin ?? "система"}</span>
                  </span>
                  <span className="text-stone-600">
                    +{r.created} · обновлено {r.updated} · без изменений {r.unchanged} · <span className={r.rejected ? "text-red-600" : ""}>отклонено {r.rejected}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Загрузок ещё не было.</p>
        )}
      </Section>
    </>
  );
}
