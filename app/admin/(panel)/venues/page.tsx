import { PageTitle, Section } from "@/components/admin/blocks";
import { Field, Input, SettingsForm } from "@/components/admin/ui";
import { saveVenue } from "@/app/admin/venues-actions";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";

/** Площадки с примерными координатами (центр города): адрес или координаты — и события встают на карту точно. */
export default async function AdminVenues() {
  await requireAdmin("MODERATOR");
  const now = new Date();
  const actual = { status: { not: "PAST" as const }, OR: [{ startsAt: { gte: now } }, { endsAt: { gte: now } }] };
  const venues = await db.venue.findMany({
    where: { OR: [{ approx: true }, { lat: null }] },
    include: { _count: { select: { events: { where: actual } } } },
    orderBy: [{ city: "asc" }, { name: "asc" }],
  });
  venues.sort((a, b) => b._count.events - a._count.events);
  const exact = await db.venue.count({ where: { approx: false, lat: { not: null } } });
  return (
    <>
      <PageTitle
        title="Площадки"
        desc={`Точные координаты — у ${exact} площадок. Ниже — площадки, где геокодер не нашёл адрес: на карте они стоят в центре города с пометкой «адрес уточняется», в поиске «рядом» не участвуют. Укажите адрес (координаты найдутся сами) или координаты из Яндекс Карт. Если все события источника — в одном здании, удобнее указать его в настройках источника.`}
      />
      {venues.length ? (
        venues.map((v) => (
          <Section key={v.id} title={v.name} desc={`${v.city} · актуальных событий: ${v._count.events}${v.lat == null ? " · координат нет" : " · сейчас — центр города"}`}>
            <SettingsForm action={saveVenue}>
              <input type="hidden" name="id" value={v.id} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Город">
                  <Input name="city" defaultValue={v.city} />
                </Field>
                <Field label="Адрес" hint="Улица и дом">
                  <Input name="address" defaultValue={v.address ?? ""} placeholder="ул. Ленина, 5/1" />
                </Field>
                <Field label="Координаты" hint="Широта, долгота — необязательно">
                  <Input name="coords" placeholder="54.7230, 55.9446" />
                </Field>
              </div>
            </SettingsForm>
          </Section>
        ))
      ) : (
        <Section>
          <p className="text-sm text-stone-500">У всех площадок точные координаты.</p>
        </Section>
      )}
    </>
  );
}
