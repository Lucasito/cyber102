import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { Field, Input, Select, SettingsForm, Textarea, Toggle } from "@/components/admin/ui";
import { submitEvent } from "@/app/admin/organizer-actions";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";

/** Новое событие от организатора — уходит на модерацию. */
export default async function NewOrganizerEvent() {
  await requireAdmin("ORGANIZER");
  const categories = await db.category.findMany({ orderBy: { name: "asc" }, select: { slug: true, name: true } });
  return (
    <>
      <p className="text-sm">
        <Link href="/admin/my" className="text-stone-500 hover:underline">
          ← Мои события
        </Link>
      </p>
      <PageTitle title="Новое событие" desc="Звёздочкой отмечены обязательные поля. После проверки модератором событие появится в афише." />
      <Section>
        <SettingsForm action={submitEvent} submitLabel="Отправить на модерацию">
          <Field label="Название *">
            <Input name="title" required minLength={3} maxLength={300} placeholder="Вечер органной музыки" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Начало *" hint="Местное время">
              <Input name="dateStart" type="datetime-local" required />
            </Field>
            <Field label="Окончание" hint="Для выставки — последний день">
              <Input name="dateEnd" type="datetime-local" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Город *" hint="Только Республика Башкортостан">
              <Input name="city" required placeholder="Уфа" />
            </Field>
            <Field label="Площадка *">
              <Input name="venue" required placeholder="Концертный зал «Гармония»" />
            </Field>
          </div>
          <Field label="Адрес площадки" hint="Для карты и маршрута">
            <Input name="address" placeholder="ул. Музыкальная, 5" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Цена от, ₽">
              <Input name="priceMin" type="number" min={0} />
            </Field>
            <Field label="Цена до, ₽">
              <Input name="priceMax" type="number" min={0} />
            </Field>
            <Field label="Возраст">
              <Select name="ageLimit" defaultValue="">
                <option value="">—</option>
                {["0", "6", "12", "16", "18"].map((a) => (
                  <option key={a} value={a}>
                    {a}+
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Жанр">
              <Select name="category" defaultValue="">
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="space-y-2">
            <Toggle name="isFree" defaultChecked={false} label="Вход свободный" />
            <Toggle name="pushkin" defaultChecked={false} label="Можно по Пушкинской карте" />
          </div>
          <Field label="Описание">
            <Textarea name="description" maxLength={5000} placeholder="Что зрителя ждёт — 2–3 предложения" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Страница события *" hint="На вашем сайте или в соцсети — ссылка на первоисточник">
              <Input name="sourceUrl" type="url" required placeholder="https://…" />
            </Field>
            <Field label="Билеты">
              <Input name="ticketUrl" type="url" placeholder="https://…" />
            </Field>
          </div>
        </SettingsForm>
      </Section>
    </>
  );
}
