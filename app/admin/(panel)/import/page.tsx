import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { fmtDateTime } from "@/components/admin/event-badges";
import { ImportForm } from "@/components/admin/import-form";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";

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
      <Section title="Формат файла">
        <div className="space-y-2 text-sm text-stone-600">
          <p>
            Первая строка CSV — заголовки, разделитель «;» или «,». JSON — массив объектов. Названия колонок — как в ТЗ (<code>title</code>, <code>date_start</code>,{" "}
            <code>city</code>, <code>venue</code>, <code>source_url</code>…) или по-русски (название, дата, город, площадка, источник).
          </p>
          <p>
            <b>Обязательные:</b> название, дата начала, город, площадка, ссылка на источник. <b>Желательные:</b> категория, цена (числом или текстом: «вход свободный»,
            «от 300 до 800 ₽»), возраст, адрес, описание, метки, язык, ссылки на билеты и организатора, статус («отменено», «перенесено», «черновик»).
          </p>
          <p>
            Даты: <code>2026-11-14 19:00</code>, <code>14.11.2026 19:00</code>, «14 ноября 2026 в 19:00» — местное время. Город сверяется со справочником, опечатки
            исправляются («стерлитакмак» → Стерлитамак).
          </p>
          <p>
            Образец с разными случаями — <code>docs/samples/events-sample.csv</code> в репозитории.
          </p>
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
