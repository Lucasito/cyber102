import { More, PageTitle, Section } from "@/components/admin/blocks";
import { ActionButton, Field, Input, SettingsForm, Textarea } from "@/components/admin/ui";
import { CLARIFY_SUGGESTIONS, CLARIFY_TEXT, FOLLOWUP_SUGGESTIONS } from "@/lib/server/agent";
import { requireAdmin } from "@/lib/server/admin";
import { getSettings, settingsSchema, type Settings } from "@/lib/server/settings";
import { resetTuning, saveTuning } from "../../actions";

/** Поля: ключ настройки, подпись, единица, шаг. Значение по умолчанию — из схемы. */
const GROUPS: { title: string; hint: string; fields: [keyof Settings<"tuning">, string, string, number][] }[] = [
  {
    title: "ИИ",
    hint: "ожидание, повторы, кэш, температура",
    fields: [
      ["aiTimeoutSec", "Ожидание ответа модели", "с", 1],
      ["queueWaitSec", "Ожидание в очереди", "с", 1],
      ["retries", "Повторов при перегрузке", "раз", 1],
      ["retryBaseSec", "Первая пауза перед повтором (дальше ×2)", "с", 0.1],
      ["breakerSec", "Не обращаться к ИИ после сбоя", "с", 1],
      ["cacheMin", "Кэш одинаковых запросов", "мин", 1],
      ["parseTemperature", "Температура разбора запроса", "", 0.05],
      ["explainTemperature", "Температура объяснения", "", 0.05],
      ["explainMaxTokens", "Длина объяснения, не больше", "токенов", 10],
      ["dialogMemory", "Память диалога в ботах", "реплик", 1],
      ["agentEvents", "Событий в ответе помощника", "шт.", 1],
    ],
  },
  {
    title: "Поиск и сайт",
    hint: "карточки, радиус, возраст",
    fields: [
      ["pageSize", "Карточек на странице каталога", "шт.", 1],
      ["chatEvents", "Карточек под ответом в чате (остальные — «Показать ещё»)", "шт.", 1],
      ["radiusKm", "Радиус «Рядом со мной»", "км", 1],
      ["kidsAge", "Возраст для «с ребёнком»", "лет", 1],
      ["teenAge", "Возраст для «с подростком»", "лет", 1],
      ["defaultDurationHours", "Событие без даты окончания длится", "ч", 0.5],
      ["analyticsDays", "Период аналитики", "дней", 1],
    ],
  },
  {
    title: "Боты и напоминания",
    hint: "события в ответе, сроки напоминаний",
    fields: [
      ["botEvents", "Событий в ответе бота", "шт.", 1],
      ["remindHours", "Напоминать до начала за", "ч", 1],
      ["remindFallbackHours", "Если до начала меньше — за", "ч", 0.5],
      ["exhibitionRemindDays", "Выставка: до закрытия за", "дней", 1],
    ],
  },
];

export default async function AdminTuning() {
  await requireAdmin();
  const tuning = await getSettings("tuning");
  const defaults = settingsSchema.tuning.parse({});
  const textsChanged = !!tuning.clarifyText || tuning.clarifySuggestions.length > 0 || tuning.followupSuggestions.length > 0;
  return (
    <>
      <PageTitle title="Тонкая настройка" desc="Числа и тексты, от которых зависит работа помощника, ботов и сайта. Обычно менять не нужно. Пустое поле — значение по умолчанию; изменённые группы раскрыты." />
      <Section>
        <SettingsForm action={saveTuning} extra={<ActionButton action={resetTuning} confirm="Вернуть все параметры к значениям по умолчанию?">Вернуть по умолчанию</ActionButton>}>
          {GROUPS.map((g) => (
            <More key={g.title} title={g.title} hint={g.hint} open={g.fields.some(([k]) => tuning[k] !== defaults[k])}>
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.fields.map(([key, label, unit, step]) => (
                  <Field key={key} label={label} hint={`${unit ? `${unit} · ` : ""}по умолчанию ${defaults[key]}`}>
                    <Input name={key} type="number" step={step} min={0} defaultValue={String(tuning[key])} />
                  </Field>
                ))}
              </div>
            </More>
          ))}
          <More title="Тексты помощника" hint="уточняющий вопрос и кнопки" open={textsChanged}>
            <Field label="Уточняющий вопрос" hint="Задаётся, когда в запросе нет ни даты, ни жанра, ни бюджета. Только для русской версии.">
              <Textarea name="clarifyText" defaultValue={tuning.clarifyText} placeholder={CLARIFY_TEXT} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Кнопки к уточняющему вопросу" hint="По одной в строке.">
                <Textarea name="clarifySuggestions" rows={5} defaultValue={tuning.clarifySuggestions.join("\n")} placeholder={CLARIFY_SUGGESTIONS.join("\n")} />
              </Field>
              <Field label="Кнопки после подборки" hint="По одной в строке. «Новый поиск» сбрасывает диалог.">
                <Textarea name="followupSuggestions" rows={5} defaultValue={tuning.followupSuggestions.join("\n")} placeholder={FOLLOWUP_SUGGESTIONS.join("\n")} />
              </Field>
            </div>
          </More>
        </SettingsForm>
      </Section>
    </>
  );
}
