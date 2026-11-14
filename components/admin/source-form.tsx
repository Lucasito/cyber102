import { Field, Input, Select, SettingsForm, Textarea, Toggle } from "@/components/admin/ui";
import type { Source } from "@/generated/prisma/client";
import { ADAPTERS } from "@/lib/server/collect/adapters";
import { SOURCE_KINDS } from "@/lib/server/collect";
import { saveSource } from "@/app/admin/sources-actions";

/** Форма источника: новый или существующий. */
export function SourceForm({ source }: { source?: Source }) {
  const adapters = Object.entries(ADAPTERS);
  return (
    <SettingsForm action={saveSource}>
      {source && <input type="hidden" name="id" value={source.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Название" hint="Как источник называется в админке и отчётах">
          <Input name="name" required defaultValue={source?.name} placeholder="Башкирская филармония — афиша" />
        </Field>
        <Field label="Код" hint="Латиницей; пишется в события как источник: bashgf, sgtko">
          <Input name="code" required defaultValue={source?.code} placeholder="bashgf" pattern="[a-z0-9][a-z0-9._\-]{1,39}" />
        </Field>
      </div>
      <Field label="Тип источника">
        <Select name="kind" defaultValue={source?.kind ?? "universal_json"}>
          {Object.entries(SOURCE_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label} — {v.hint}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Адрес" hint="Лента RSS, адрес JSON или страница афиши — откуда забирать события">
        <Input name="url" type="url" required defaultValue={source?.url} placeholder="https://bashgf.ru/afisha/feed/" />
      </Field>
      {adapters.length > 0 && (
        <Field label="Индивидуальный парсер" hint="Только для типа «Индивидуальный парсер»">
          <Select name="adapter" defaultValue={source?.adapter ?? ""}>
            <option value="">—</option>
            {adapters.map(([k, a]) => (
              <option key={k} value={k}>
                {a.name} — {a.description}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Город по умолчанию" hint="Если в записи города нет">
          <Input name="city" defaultValue={source?.city ?? ""} placeholder="Уфа" />
        </Field>
        <Field label="Время сбора" hint="Каждый день в это время по Уфе; пусто — по интервалу">
          <Input name="collectAt" type="time" defaultValue={source ? (source.collectAt ?? "") : "06:00"} />
        </Field>
        <Field label="Или раз в, часов" hint="Если время сбора не задано">
          <Input name="intervalHours" type="number" min={1} max={168} defaultValue={source?.intervalHours ?? 12} />
        </Field>
        <Field label="Новых записей за раз" hint="Для «RSS + ИИ» ограничивает расходы">
          <Input name="maxItems" type="number" min={1} max={100} defaultValue={source?.maxItems ?? 20} />
        </Field>
      </div>
      <fieldset className="space-y-3 rounded-2xl bg-stone-50 p-4">
        <legend className="px-1 text-sm font-medium">Площадка источника</legend>
        <p className="text-xs text-stone-500">
          Если все события источника проходят в одном здании (театр, музей, филармония) — укажите его. Записи без площадки или с похожим названием
          привязываются к нему, зал сохраняется («Театр „Нур“, Малый зал»). Координаты не обязательны: без них найдутся по адресу.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Название здания">
            <Input name="venueName" defaultValue={source?.venueName ?? ""} placeholder="Театр «Нур»" />
          </Field>
          <Field label="Адрес" hint="Улица и дом; город — из поля выше">
            <Input name="venueAddress" defaultValue={source?.venueAddress ?? ""} placeholder="ул. Ленина, 5/1" />
          </Field>
          <Field label="Координаты" hint="Широта, долгота — например, из Яндекс Карт (необязательно)">
            <Input name="venueCoords" defaultValue={source?.venueLat != null ? `${source.venueLat}, ${source.venueLon}` : ""} placeholder="54.7230, 55.9446" />
          </Field>
        </div>
      </fieldset>
      <div className="space-y-2">
        <Toggle name="enabled" defaultChecked={source?.enabled ?? false} label="Собирать по расписанию" />
        <Toggle name="autoPublish" defaultChecked={source?.autoPublish ?? false} label="Публиковать прошедшие проверку сразу (не для разбора ИИ)" />
        <p className="text-xs text-stone-500">
          Без автопубликации все новые события источника попадают в «Модерацию». Разобранное ИИ — всегда через модерацию. Существующие в афише события
          недоверенный источник не меняет.
        </p>
      </div>
      <Field label="Заметка">
        <Textarea name="note" defaultValue={source?.note ?? ""} placeholder="Особенности источника, контакт учреждения" />
      </Field>
    </SettingsForm>
  );
}
