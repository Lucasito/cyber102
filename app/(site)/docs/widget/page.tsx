import type { Metadata } from "next";
import Link from "next/link";
import { WidgetBuilder } from "@/components/widget-builder";
import { filterOptions } from "@/lib/server/events";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Конструктор виджета" };

/** Конструктор виджета для сторонних сайтов: настройки → предпросмотр и готовый код. */
export default async function WidgetBuilderPage() {
  const { cities, categories } = await filterOptions();
  const base = process.env.PUBLIC_URL ?? "";
  return (
    <main className="mx-auto max-w-6xl px-4 pt-10 pb-16">
      <p className="text-sm text-stone-500">
        <Link href="/docs" className="hover:text-stone-900">
          API и виджет
        </Link>{" "}
        / Конструктор
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Виджет афиши для вашего сайта</h1>
      <p className="mt-3 max-w-3xl text-stone-600">
        Выберите, какие события показывать и как, — код ниже обновляется сразу. Вставьте его на страницу сайта: виджет работает во фрейме, не меняет стили и
        скрипты сайта и не использует cookies. События обновляются сами — период «выходные» всегда означает ближайшие выходные.
      </p>
      <p className="mt-3">
        <a href="/widget-demo" target="_blank" rel="noopener" className="font-medium text-[var(--brand)] hover:underline">
          Посмотреть виджет на примере сайта ↗
        </a>
        <span className="text-sm text-stone-500"> — выдуманная страница со светлым, бежевым и тёмным фоном</span>
      </p>
      <div className="mt-8">
        <WidgetBuilder base={base} cities={cities} categories={categories.map((c) => ({ value: c.slug, label: c.name }))} />
      </div>
    </main>
  );
}
