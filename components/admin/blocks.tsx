import { Select } from "./ui";

// Общие блоки страниц админки (серверные компоненты).

export function PageTitle({ title, desc }: { title: string; desc?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {desc && <p className="mt-1 max-w-2xl text-sm text-stone-500">{desc}</p>}
    </div>
  );
}

export function Section({ title, desc, children }: { title?: string; desc?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5 ring-1 ring-black/5 sm:p-7">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {desc && <p className="mt-1 text-sm text-stone-500">{desc}</p>}
      <div className={title || desc ? "mt-5" : ""}>{children}</div>
    </section>
  );
}

/** Свёрнутый блок для редко нужных полей: открыт сразу, если в нём что-то изменено. */
export function More({ title, hint, open, children }: { title: string; hint?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-2xl border border-black/10 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold select-none">
        <span className="inline-block transition group-open:rotate-90">›</span>
        {title}
        {hint && <span className="hidden font-normal text-stone-500 sm:inline">— {hint}</span>}
      </summary>
      <div className="space-y-4 px-4 pb-4">{children}</div>
    </details>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" }) {
  return (
    <div className={`rounded-2xl p-4 ${tone === "warn" ? "bg-amber-50" : "bg-stone-100"}`}>
      <div className={`text-2xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-800" : ""}`}>{value}</div>
      <div className="mt-0.5 text-sm text-stone-500">{label}</div>
    </div>
  );
}

export function QueryList({ items, empty }: { items: { text: string; count: number }[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-stone-500">{empty}</p>;
  return (
    <ol className="space-y-1 text-sm">
      {items.map((q) => (
        <li key={q.text} className="flex justify-between gap-4 rounded-lg bg-stone-100 px-3 py-1.5">
          <span className="min-w-0 truncate">{q.text}</span>
          <b className="shrink-0 tabular-nums">{q.count}</b>
        </li>
      ))}
    </ol>
  );
}

/** Выбор модели из списка; текущее значение сохраняется, даже если его нет в списке. */
export function ModelSelect({ name, value, models, defaultLabel }: { name: string; value: string; models: string[]; defaultLabel: string }) {
  const options = value && !models.includes(value) ? [value, ...models] : models;
  return (
    <Select name={name} defaultValue={value}>
      <option value="">{defaultLabel}</option>
      {options.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </Select>
  );
}
