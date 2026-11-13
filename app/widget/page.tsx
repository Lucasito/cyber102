import { EventCard } from "@/components/event-card";
import { toCard } from "@/lib/format";
import { DEMO_SOURCE } from "@/lib/demo-data";
import { db } from "@/lib/server/db";
import { parseEventFilter, searchEvents } from "@/lib/server/events";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

/** Виджет для встраивания (iframe) на сторонние сайты — см. /docs и public/widget.js. */
export default async function Widget({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const parsed = parseEventFilter({ limit: "6", ...sp });
  const result = parsed.success ? await searchEvents(parsed.data) : { items: [] };
  const base = process.env.PUBLIC_URL ?? "";
  const demo = (await getSettings("site")).testBanner && (await db.event.count({ where: { sources: { some: { source: DEMO_SOURCE } } }, take: 1 })) > 0;
  return (
    <main className="p-2">
      {demo && <p className="mb-2 rounded-lg bg-amber-100 px-3 py-1.5 text-center text-xs text-amber-900">Тестовые данные — события условные</p>}
      {result.items.length ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {result.items.map((e) => (
            <EventCard key={e.id} event={toCard(e)} target="_blank" tile />
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-stone-500">Ближайших событий нет</p>
      )}
      <a href={`${base}/`} target="_blank" rel="noopener" className="mt-3 block text-center text-sm text-stone-500 hover:text-stone-900">
        Вся афиша культуры Башкортостана →
      </a>
    </main>
  );
}
