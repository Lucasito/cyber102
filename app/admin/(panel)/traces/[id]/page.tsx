import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle, Section, Stat } from "@/components/admin/blocks";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { BY_LABELS, MODE_LABELS, RELAX_LABELS, SOURCE_LABELS, STEP_LABELS } from "@/lib/trace-labels";

type Step = { step: string; ms?: number; ai?: boolean; [k: string]: unknown };
type Call = { provider: string; tokens: number; ms: number; cached?: boolean; error?: string };
type Trace = { steps?: Step[]; calls?: Call[]; reply?: string };

/** Одна трасса ответа агента: шаги, вызовы модели, события-основания. */
export default async function AdminTrace({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const row = await db.queryLog.findUnique({ where: { id } });
  if (!row) notFound();
  const trace = (row.trace ?? {}) as Trace;
  const events = row.eventIds.length
    ? await db.event.findMany({ where: { id: { in: row.eventIds } }, select: { id: true, title: true, startsAt: true, sources: { select: { url: true }, take: 1 } } })
    : [];
  const byId = new Map(events.map((e) => [e.id, e]));
  const dialog = row.dialogKey
    ? await db.queryLog.findMany({ where: { dialogKey: row.dialogKey }, orderBy: { createdAt: "asc" }, select: { id: true, text: true, costRub: true } })
    : [];

  return (
    <>
      <p className="text-sm">
        <Link href="/admin/traces" className="text-stone-500 hover:underline">
          ← Все трассы
        </Link>
      </p>
      <PageTitle
        title={`«${row.text.slice(0, 80)}»`}
        desc={`${SOURCE_LABELS[row.source] ?? row.source} · ${row.createdAt.toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg" })}${row.userKey ? ` · ${row.userKey}` : ""}`}
      />
      <Section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="режим" value={MODE_LABELS[row.mode] ?? row.mode} tone={row.mode === "ai" ? undefined : "warn"} />
          <Stat label="время ответа" value={`${(row.latencyMs / 1000).toFixed(1)} с`} />
          <Stat label="токенов" value={row.tokens} />
          <Stat label="стоимость" value={`${row.costRub.toFixed(2)} ₽`} />
        </div>
        {trace.reply && (
          <div className="mt-4">
            <p className="mb-1 text-sm font-medium text-stone-700">Ответ</p>
            <p className="rounded-xl bg-stone-50 p-3 text-sm whitespace-pre-wrap">{trace.reply}</p>
          </div>
        )}
      </Section>

      <Section title="Шаги">
        <ol className="space-y-3 text-sm">
          {(trace.steps ?? []).map((s, i) => {
            const { step, ms, ai, ...data } = s;
            return (
              <li key={i} className="rounded-xl border border-black/10 p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <b>
                    {i + 1}. {STEP_LABELS[step] ?? step}
                    {typeof data.name === "string" ? ` ${data.name}` : ""}
                    {typeof data.relax === "string" ? ` — без условия «${RELAX_LABELS[data.relax] ?? data.relax}»` : ""}
                  </b>
                  {ai != null && <span className={`text-xs ${ai ? "text-emerald-700" : "text-amber-700"}`}>{ai ? "ИИ" : "без ИИ"}</span>}
                  {ms != null && <span className="text-xs text-stone-500">{ms} мс</span>}
                  {typeof data.by === "string" && <span className="text-xs text-stone-500">выбрал: {BY_LABELS[data.by] ?? data.by}</span>}
                  {data.ok === false && <span className="text-xs text-amber-700">ошибка</span>}
                  {data.pending === true && <span className="text-xs text-amber-700">ждёт подтверждения</span>}
                  {Array.isArray((data.result as { events?: unknown[] } | undefined)?.events) && (
                    <span className="text-xs text-stone-500">событий: {(data.result as { events: unknown[] }).events.length}</span>
                  )}
                </div>
                {Object.keys(data).length > 0 && (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-stone-50 p-2 text-xs">{JSON.stringify(data, null, 2)}</pre>
                )}
              </li>
            );
          })}
        </ol>
      </Section>

      <Section title="Вызовы модели">
        {trace.calls?.length ? (
          <ul className="space-y-1 text-sm">
            {trace.calls.map((c, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span className="font-medium">{c.provider}</span>
                <span className="tabular-nums text-stone-600">{c.cached ? "из кэша" : `${c.tokens} ток., ${c.ms} мс`}</span>
                {c.error && <span className="text-amber-700">{c.error}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Модель не вызывалась</p>
        )}
      </Section>

      <Section title="События-основания" desc="Ответ построен только на этих записях базы.">
        {row.eventIds.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {row.eventIds.map((eid) => {
              const e = byId.get(eid);
              return (
                <li key={eid}>
                  {e ? (
                    <>
                      <Link href={`/admin/events/${eid}`} className="hover:underline">
                        {e.title}
                      </Link>
                      <span className="text-stone-500"> · {e.startsAt.toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      {e.sources[0] && (
                        <a href={e.sources[0].url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-stone-500 underline">
                          источник
                        </a>
                      )}
                    </>
                  ) : (
                    <span className="text-stone-500">{eid} (удалено)</span>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-stone-500">Событий в ответе нет</p>
        )}
      </Section>

      {dialog.length > 1 && (
        <Section title="Диалог" desc={`Всего: ${dialog.reduce((n, d) => n + d.costRub, 0).toFixed(2)} ₽`}>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {dialog.map((d) => (
              <li key={d.id}>
                {d.id === row.id ? <b>{d.text}</b> : <Link href={`/admin/traces/${d.id}`} className="hover:underline">{d.text}</Link>}
              </li>
            ))}
          </ol>
        </Section>
      )}
    </>
  );
}
