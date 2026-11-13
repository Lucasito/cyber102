import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { requireAdmin } from "@/lib/server/admin";
import { SOURCE_KINDS, type SourceKind } from "@/lib/server/collect";
import { db } from "@/lib/server/db";

const when = (d: Date | null) =>
  d ? d.toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "ещё не собирался";

/** Источники событий для сборщика: модератор и администратор. */
export default async function AdminSources() {
  await requireAdmin("MODERATOR");
  const sources = await db.source.findMany({ orderBy: [{ enabled: "desc" }, { name: "asc" }], include: { _count: { select: { items: true } } } });
  return (
    <>
      <PageTitle
        title="Источники"
        desc={
          <>
            Откуда сборщик забирает события. Всё собранное проходит общие проверки (Башкортостан, дата, дубли, ссылка отвечает) и при необходимости —
            модерацию. Учреждениям предлагаем{" "}
            <Link href="/docs/format" className="underline">
              универсальный формат
            </Link>{" "}
            — тогда ИИ не нужен.
          </>
        }
      />
      <div>
        <Link href="/admin/sources/new" className="inline-flex rounded-full bg-stone-900 px-5 py-2 text-sm font-medium text-white hover:bg-stone-700">
          Добавить источник
        </Link>
      </div>
      <Section>
        {sources.length ? (
          <ul className="divide-y divide-black/5">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <div className="min-w-0">
                  <Link href={`/admin/sources/${s.id}`} className="font-medium hover:underline">
                    {s.name}
                  </Link>
                  <div className="text-xs text-stone-500">
                    {SOURCE_KINDS[s.kind as SourceKind]?.label ?? s.kind} · {s.code} · {hostOf(s.url)}
                    {s.kind === "rss_ai" && ` · разобрано записей: ${s._count.items}`}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div className={s.enabled ? "text-emerald-700" : "text-stone-400"}>{s.enabled ? `раз в ${s.intervalHours} ч` : "выключен"}</div>
                  <div className={s.lastStatus === "error" ? "text-red-700" : "text-stone-500"}>{when(s.lastRunAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Источников пока нет. Начальный список из docs/DATA_SOURCES.md добавляет команда npm run sources:seed.</p>
        )}
      </Section>
      <Section title="Типы источников">
        <ul className="space-y-2 text-sm">
          {Object.entries(SOURCE_KINDS).map(([k, v]) => (
            <li key={k}>
              <b>{v.label}</b> — {v.hint}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
