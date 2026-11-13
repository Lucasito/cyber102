import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { EventForm } from "@/components/admin/event-form";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";

export default async function AdminEventNew() {
  await requireAdmin("MODERATOR");
  const [categories, cities] = await Promise.all([db.category.findMany({ orderBy: { name: "asc" } }), db.venue.findMany({ distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } })]);
  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/admin/events">← События</Link>
      </p>
      <PageTitle title="Новое событие" desc="Ручной ввод. Ссылка на источник обязательна: выдуманных событий в афише нет. Город и площадка сверяются со справочником." />
      <Section>
        <EventForm categories={categories} cities={cities.map((c) => c.city)} />
      </Section>
    </>
  );
}
