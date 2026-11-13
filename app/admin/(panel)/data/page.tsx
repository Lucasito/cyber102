import { PageTitle, Section, Stat } from "@/components/admin/blocks";
import { ActionButton } from "@/components/admin/ui";
import { DEMO_SOURCE } from "@/lib/demo-data";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { loadDemo, removeDemo } from "../../actions";

export default async function AdminData() {
  await requireAdmin();
  const [total, demo] = await Promise.all([db.event.count(), db.event.count({ where: { sources: { some: { source: DEMO_SOURCE } } } })]);
  return (
    <>
      <PageTitle title="Данные" desc="Тестовые события. Импорт, правка и модерация реальных событий — в разделах «События», «Импорт» и «Модерация»." />
      <Section title="Тестовые события" desc="Помечены источником demo. Пока они есть, на сайте видна плашка «Тестовые данные» (если она включена в разделе «Сайт»).">
        <div className="mb-5 grid grid-cols-2 gap-3 sm:w-1/2">
          <Stat label="всего событий" value={total} />
          <Stat label="тестовых" value={demo} tone={demo ? "warn" : undefined} />
        </div>
        <div className="flex flex-wrap gap-4">
          <ActionButton action={loadDemo} confirm="Пересоздать тестовые события с датами от сегодняшнего дня?">
            Загрузить тестовые данные
          </ActionButton>
          <ActionButton action={removeDemo} confirm="Удалить все тестовые события?">
            Удалить тестовые данные
          </ActionButton>
        </div>
      </Section>
    </>
  );
}
