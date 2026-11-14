import { PageTitle, Section } from "@/components/admin/blocks";
import Link from "next/link";
import { ActionButton, Field, Input, Select, SettingsForm, Toggle } from "@/components/admin/ui";
import { addAlias, mergeVenueRecords, removeAlias, saveVenue, setVenueBuilding } from "@/app/admin/venues-actions";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";

/** Площадки с примерными координатами (центр города): адрес или координаты — и события встают на карту точно. */
export default async function AdminVenues({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  await requireAdmin("MODERATOR");
  const { q = "", view } = await searchParams;
  const now = new Date();
  const actual = { status: { not: "PAST" as const }, OR: [{ startsAt: { gte: now } }, { endsAt: { gte: now } }] };
  const venues = await db.venue.findMany({
    where: { AND: [view === "missing" ? { OR: [{ approx: true }, { lat: null }, { lon: null }] } : {}, q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { aliases: { some: { name: { contains: q, mode: "insensitive" } } } }] } : {}] },
    include: { aliases: { orderBy: { name: "asc" } }, building: true, _count: { select: { events: { where: actual } } } },
    orderBy: [{ city: "asc" }, { name: "asc" }],
    take: 100,
  });
  venues.sort((a, b) => b._count.events - a._count.events);
  const exact = await db.venue.count({ where: { approx: false, lat: { not: null } } });
  const all = await db.venue.findMany({ select: { id: true, name: true, city: true, buildingId: true }, orderBy: [{ city: "asc" }, { name: "asc" }] });
  return (
    <>
      <PageTitle
        title="Площадки"
        desc={`Точное местоположение — у ${exact} площадок. Подтверждённый адрес можно защитить от импорта. Варианты названий ведут к одной площадке, а залы можно привязать к зданию. Противоречия источников проверяются в разделе «Модерация».`}
      />
      <Section>
        <form className="flex flex-wrap items-end gap-3">
          <Field label="Найти площадку"><Input name="q" defaultValue={q} placeholder="Название, город или вариант названия" /></Field>
          <Field label="Показать"><Select name="view" defaultValue={view ?? "all"}><option value="all">Все площадки</option><option value="missing">Адрес уточняется</option></Select></Field>
          <button className="rounded-full bg-stone-900 px-4 py-2 text-sm text-white">Найти</button>
          <Link href="/admin/moderation" className="py-2 text-sm underline">Проверить изменения источников</Link>
        </form>
        <p className="mt-3 text-xs text-stone-500">Показано: {venues.length}{venues.length === 100 ? ". Уточните поиск, чтобы найти остальные." : ""}</p>
      </Section>
      {venues.length ? (
        venues.map((v) => (
          <Section key={v.id} title={v.name} desc={`${v.city} · актуальных событий: ${v._count.events}${v.lat == null || v.approx ? " · адрес уточняется" : " · точное местоположение"}${v.locationLocked ? " · адрес защищён" : ""}${v.building ? ` · зал в здании «${v.building.name}»` : ""}`}>
            <details open={view === "missing"}>
              <summary className="mb-4 cursor-pointer text-sm text-stone-600">Адрес, варианты названий и здание</summary>
            <SettingsForm action={saveVenue}>
              <input type="hidden" name="id" value={v.id} />
              <input type="hidden" name="version" value={v.updatedAt.toISOString()} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Город">
                  <Input name="city" defaultValue={v.city} />
                </Field>
                <Field label="Адрес" hint="Улица и дом">
                  <Input name="address" defaultValue={v.address ?? ""} placeholder="ул. Ленина, 5/1" />
                </Field>
                <Field label="Координаты" hint="Широта, долгота — необязательно">
                  <Input name="coords" defaultValue={!v.approx && v.lat != null && v.lon != null ? `${v.lat}, ${v.lon}` : ""} placeholder="54.7230, 55.9446" />
                </Field>
              </div>
              <Toggle name="locationLocked" defaultChecked={v.locationLocked || !v.buildingId} label="Защитить адрес, город и координаты от автоматического изменения" />
              {v.locationVerifiedAt && <p className="text-xs text-stone-500">Проверено модератором: {v.locationVerifiedAt.toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg" })}</p>}
            </SettingsForm>
            <div className="mt-6 border-t border-black/5 pt-4">
              <p className="mb-2 text-sm font-medium">Варианты названия</p>
              {v.aliases.map((a) => <div key={a.id} className="mb-2 flex flex-wrap items-center gap-3 text-sm"><span>{a.name} · {a.city}</span><ActionButton action={removeAlias.bind(null, a.id)} confirm="Удалить этот вариант названия?">Удалить</ActionButton></div>)}
              <SettingsForm action={addAlias} submitLabel="Добавить вариант">
                <input type="hidden" name="id" value={v.id} />
                <div className="grid gap-3 sm:grid-cols-2"><Field label="Название в источнике"><Input name="alias" required maxLength={200} /></Field><Field label="Город в источнике" hint="Можно указать ошибочный город источника: события всё равно попадут на правильную площадку."><Input name="aliasCity" defaultValue={v.city} required /></Field></div>
              </SettingsForm>
            </div>
            <div className="mt-6 border-t border-black/5 pt-4">
              <SettingsForm action={setVenueBuilding} submitLabel="Сохранить здание">
                <input type="hidden" name="id" value={v.id} />
                <Field label="Здание для этого зала" hint="Зал получает адрес здания, если его собственный адрес не защищён отдельно."><Select name="buildingId" defaultValue={v.buildingId ?? ""}><option value="">Отдельная площадка</option>{all.filter((b) => !b.buildingId && b.id !== v.id).map((b) => <option key={b.id} value={b.id}>{b.city} · {b.name}</option>)}</Select></Field>
              </SettingsForm>
            </div>
            </details>
          </Section>
        ))
      ) : (
        <Section>
          <p className="text-sm text-stone-500">По этим условиям площадок нет.</p>
        </Section>
      )}
      <Section title="Объединить варианты одной площадки" desc="Выберите два названия одного здания или одного зала. События, источники и напоминания сохранятся. Старое название станет вариантом оставшейся площадки.">
        <SettingsForm action={mergeVenueRecords} submitLabel="Объединить площадки">
          <div className="grid gap-3 sm:grid-cols-2">{[["keepId", "Оставить площадку"], ["dropId", "Перенести сюда события из"]].map(([name, label]) => <Field key={name} label={label}><Select name={name} required defaultValue=""><option value="" disabled>Выберите площадку</option>{all.map((v) => <option key={v.id} value={v.id}>{v.city} · {v.name}</option>)}</Select></Field>)}</div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirmed" required />Это одно здание или один зал; адрес оставшейся площадки проверен</label>
        </SettingsForm>
      </Section>
    </>
  );
}
