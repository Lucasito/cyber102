import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { ImportForm } from "@/components/admin/import-form";
import { requireAdmin } from "@/lib/server/admin";

/** Загрузка списка событий файлом — все новые события уходят на модерацию. */
export default async function OrganizerImport() {
  await requireAdmin("ORGANIZER");
  return (
    <>
      <p className="text-sm">
        <Link href="/admin/my" className="text-stone-500 hover:underline">
          ← Мои события
        </Link>
      </p>
      <PageTitle
        title="Загрузить файл"
        desc={
          <>
            Таблица CSV (из Excel: «Сохранить как → CSV UTF-8») или JSON. Колонки — как в{" "}
            <Link href="/docs/format" className="underline">
              универсальном формате
            </Link>
            ; названия можно по-русски: «название», «дата», «город», «площадка», «цена», «возраст», «ссылка». Новые события уходят на модерацию; события, которые уже
            есть в афише, не меняются.
          </>
        }
      />
      <Section>
        <ImportForm organizer />
      </Section>
      <Section title="Образцы">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <a href="/docs/format/sample.json" className="underline">
              Образец JSON
            </a>
          </li>
          <li>
            Таблица: колонки <code>название; дата; окончание; город; площадка; адрес; цена; возраст; жанр; ссылка</code>, одна строка — один сеанс.
          </li>
        </ul>
      </Section>
    </>
  );
}
