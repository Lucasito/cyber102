import { Field, Input, Select, SettingsForm, Textarea, Toggle } from "./ui";
import { More } from "./blocks";
import { toLocalInput } from "./event-badges";
import { saveEvent } from "@/app/admin/events-actions";

// Форма события: создание (ручной ввод) и правка. Даты — местное время республики.

type EventLike = {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  durationMin: number | null;
  status: string;
  publication: string;
  priceMin: number | null;
  priceMax: number | null;
  ageLimit: number | null;
  tags: string[];
  language: string | null;
  orgUrl: string | null;
  ticketUrl: string | null;
  imageUrl: string | null;
  pushkinCard: boolean;
  needsReview: boolean;
  reviewNote: string | null;
  category: { slug: string } | null;
  venue: { name: string; city: string; address: string | null } | null;
};

export function EventForm({ event: e, categories, cities }: { event?: EventLike; categories: { slug: string; name: string }[]; cities: string[] }) {
  return (
    <SettingsForm action={saveEvent}>
      {e && <input type="hidden" name="id" value={e.id} />}
      <Field label="Название">
        <Input name="title" required minLength={3} maxLength={300} defaultValue={e?.title} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Начало" hint="Местное время">
          <Input name="startsAt" type="datetime-local" required defaultValue={toLocalInput(e?.startsAt)} />
        </Field>
        <Field label="Окончание" hint="Если известно; для выставки — дата закрытия">
          <Input name="endsAt" type="datetime-local" defaultValue={toLocalInput(e?.endsAt)} />
        </Field>
        <Field label="Город">
          <Input name="city" required list="admin-cities" defaultValue={e?.venue?.city} />
          <datalist id="admin-cities">
            {cities.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Площадка">
          <Input name="venue" required defaultValue={e?.venue?.name} />
        </Field>
        <Field label="Адрес площадки">
          <Input name="address" defaultValue={e?.venue?.address ?? ""} />
        </Field>
        <Field label="Категория">
          <Select name="category" defaultValue={e?.category?.slug ?? ""}>
            <option value="">Другое / не указана</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Цена от, ₽" hint="Пусто — цена неизвестна">
          <Input name="priceMin" type="number" min={0} defaultValue={e?.priceMin ?? ""} />
        </Field>
        <Field label="Цена до, ₽">
          <Input name="priceMax" type="number" min={0} defaultValue={e?.priceMax ?? ""} />
        </Field>
        <Field label="Возраст">
          <Select name="ageLimit" defaultValue={e?.ageLimit != null ? String(e.ageLimit) : ""}>
            <option value="">Не указан</option>
            {[0, 6, 12, 16, 18].map((a) => (
              <option key={a} value={a}>
                {a}+
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Статус">
          <Select name="status" defaultValue={e?.status === "PAST" ? "SCHEDULED" : (e?.status ?? "SCHEDULED")}>
            <option value="SCHEDULED">Состоится</option>
            <option value="RESCHEDULED">Перенесено</option>
            <option value="SOLD_OUT">Билетов нет</option>
            <option value="CANCELLED">Отменено (из выдачи убирается)</option>
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Toggle name="free" defaultChecked={e?.priceMin === 0 && (e?.priceMax ?? 0) === 0} label="Бесплатно" />
        <Toggle name="published" defaultChecked={e ? e.publication === "PUBLISHED" : true} label="Опубликовано на сайте" />
        <Toggle name="pushkinCard" defaultChecked={e?.pushkinCard ?? false} label="Пушкинская карта" />
      </div>
      <Field label={e ? "Добавить ссылку на источник" : "Ссылка на источник"} hint={e ? "Существующие источники — ниже" : "Обязательно: откуда взято событие (сайт учреждения, афиша, соцсеть)"}>
        <Input name="sourceUrl" type="url" required={!e} placeholder="https://" />
      </Field>
      <Field label="Описание">
        <Textarea name="description" rows={4} defaultValue={e?.description ?? ""} />
      </Field>
      <More title="Дополнительно" hint="метки, язык, ссылки, длительность" open={!!(e?.tags.length || e?.language || e?.orgUrl || e?.ticketUrl || e?.imageUrl || e?.durationMin)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Метки" hint="Через запятую: джаз, дети, башкирский язык">
            <Input name="tags" defaultValue={e?.tags.join(", ")} />
          </Field>
          <Field label="Язык мероприятия">
            <Input name="language" defaultValue={e?.language ?? ""} placeholder="русский, башкирский…" />
          </Field>
          <Field label="Билеты">
            <Input name="ticketUrl" type="url" defaultValue={e?.ticketUrl ?? ""} />
          </Field>
          <Field label="Организатор">
            <Input name="orgUrl" type="url" defaultValue={e?.orgUrl ?? ""} />
          </Field>
          <Field label="Изображение">
            <Input name="imageUrl" type="url" defaultValue={e?.imageUrl ?? ""} />
          </Field>
          <Field label="Длительность, мин">
            <Input name="durationMin" type="number" min={1} defaultValue={e?.durationMin ?? ""} />
          </Field>
        </div>
      </More>
      <More title="Спорная карточка" hint="оставить в очереди модерации" open={!!e?.needsReview}>
        <Toggle name="needsReview" defaultChecked={e?.needsReview ?? false} label="Спорная — требует проверки" />
        <Field label="Почему">
          <Input name="reviewNote" defaultValue={e?.reviewNote ?? ""} />
        </Field>
      </More>
    </SettingsForm>
  );
}
