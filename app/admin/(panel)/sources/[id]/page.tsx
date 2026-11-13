import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle, Section } from "@/components/admin/blocks";
import { SourceForm } from "@/components/admin/source-form";
import { SourcePreview } from "@/components/admin/source-preview";
import { ActionButton } from "@/components/admin/ui";
import { deleteSource, forgetSourceItems, previewSourceAction, runSourceNow } from "@/app/admin/sources-actions";
import { requireAdmin } from "@/lib/server/admin";
import { SOURCE_KINDS, type SourceKind } from "@/lib/server/collect";
import { db } from "@/lib/server/db";

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const ITEM_LABELS: Record<string, string> = { imported: "в афише или модерации", rejected: "отклонено" };

/** Карточка источника: сбор, проверка без записи, настройки, история запусков, разобранные записи. */
export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("MODERATOR");
  const { id } = await params;
  const source = await db.source.findUnique({ where: { id } });
  if (!source) notFound();
  const [runs, items, itemCount] = await Promise.all([
    db.importRun.findMany({ where: { source: source.code }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.sourceItem.findMany({ where: { sourceId: id }, orderBy: { updatedAt: "desc" }, take: 15 }),
    db.sourceItem.count({ where: { sourceId: id } }),
  ]);
  const kind = SOURCE_KINDS[source.kind as SourceKind];
  return (
    <>
      <p className="text-sm">
        <Link href="/admin/sources" className="text-stone-500 hover:underline">
          ← Источники
        </Link>
      </p>
      <PageTitle
        title={source.name}
        desc={
          <>
            {kind?.label ?? source.kind} ·{" "}
            <a href={source.url} target="_blank" rel="noreferrer" className="break-all underline">
              {source.url}
            </a>
          </>
        }
      />
      <Section title="Сбор">
        <div className="space-y-4">
          {source.lastRunAt && (
            <p className={`text-sm ${source.lastStatus === "error" ? "text-red-700" : "text-stone-600"}`}>
              Последний сбор {when(source.lastRunAt)}: {source.lastMessage}
            </p>
          )}
          <SourcePreview id={source.id} action={previewSourceAction} ai={source.kind === "rss_ai"} />
          <div className="flex flex-wrap gap-3">
            <ActionButton action={runSourceNow.bind(null, source.id)}>Собрать сейчас</ActionButton>
            {source.kind === "rss_ai" && itemCount > 0 && (
              <ActionButton
                action={forgetSourceItems.bind(null, source.id)}
                confirm="Забыть разобранные записи? Следующий сбор отправит их ИИ заново (это расход токенов)."
              >
                Разобрать ленту заново
              </ActionButton>
            )}
          </div>
        </div>
      </Section>
      <Section title="Настройки">
        <SourceForm source={source} />
      </Section>
      {runs.length > 0 && (
        <Section title="Запуски">
          <ul className="divide-y divide-black/5 text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/admin/import/${r.id}`} className="hover:underline">
                  {when(r.createdAt)} · {r.userLogin ?? "—"}
                </Link>
                <span className="text-stone-500">
                  +{r.created} · обновлено {r.updated} · без изменений {r.unchanged} · отклонено {r.rejected}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {items.length > 0 && (
        <Section title="Разобранные записи ленты" desc={`Всего ${itemCount}. Разобранная запись повторно в ИИ не отправляется.`}>
          <ul className="divide-y divide-black/5 text-sm">
            {items.map((i) => (
              <li key={i.id} className="py-2">
                <span className={i.status === "imported" ? "text-emerald-700" : "text-stone-500"}>{ITEM_LABELS[i.status] ?? i.status}</span>
                {i.eventId && (
                  <Link href={`/admin/events/${i.eventId}`} className="ml-2 hover:underline">
                    событие
                  </Link>
                )}
                {i.reason && <span className="ml-2 text-xs text-stone-500">{i.reason}</span>}
                <div className="truncate text-xs text-stone-400">{i.guid}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Удаление">
        <ActionButton action={deleteSource.bind(null, source.id)} confirm={`Удалить источник «${source.name}»? События, уже попавшие в афишу, останутся.`}>
          Удалить источник
        </ActionButton>
      </Section>
    </>
  );
}
