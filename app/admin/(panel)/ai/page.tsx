import { ModelSelect, More, PageTitle, Section } from "@/components/admin/blocks";
import { ActionButton, Field, Input, SecretInput, Select, SettingsForm, Textarea, Toggle } from "@/components/admin/ui";
import { aiProviderName, aiQueueStats, DEFAULT_GIGACHAT_MODEL, gigachatBalance, gigachatUsageGroup, listModels } from "@/lib/server/ai";
import { requireAdmin } from "@/lib/server/admin";
import { getSettings, maskSecret, settingsSchema } from "@/lib/server/settings";
import { envFallbacks, saveAi, testAi } from "../../actions";

export default async function AdminAi() {
  await requireAdmin();
  const [ai, env, provider, [gigaModels, balance], llmModels] = await Promise.all([
    getSettings("ai"),
    envFallbacks(),
    aiProviderName(),
    // К GigaChat — по очереди: на параллельные запросы он отвечает 429
    (async () => [await listModels("gigachat"), await gigachatBalance()] as const)(),
    listModels("openai"),
  ]);
  const defaults = settingsSchema.ai.parse({});
  const queue = aiQueueStats();
  const usageGroup = balance.model ? gigachatUsageGroup(balance.model) : null;
  const loadChanged =
    ai.concurrency !== defaults.concurrency ||
    ai.fallback !== defaults.fallback ||
    ai.rateIpMinute !== defaults.rateIpMinute ||
    ai.rateIpDay !== defaults.rateIpDay ||
    ai.rateUserMinute !== defaults.rateUserMinute ||
    ai.rateUserDay !== defaults.rateUserDay;

  return (
    <>
      <PageTitle title="ИИ-помощник" desc={<>Модель для умного поиска на сайте и в ботах. Сейчас работает: <b className="text-stone-800">{provider ?? "выключен — поиск по правилам"}</b>. Изменения применяются сразу.</>} />
      <Section>
        <SettingsForm action={saveAi} extra={<ActionButton action={testAi}>Проверить ИИ</ActionButton>}>
          <Toggle name="enabled" defaultChecked={ai.enabled} label="Умный поиск включён" />
          <Field label="Провайдер">
            <Select name="provider" defaultValue={ai.provider}>
              <option value="">Автоматически (GigaChat, если задан ключ, иначе OpenAI-совместимый)</option>
              <option value="gigachat">GigaChat (Сбер)</option>
              <option value="openai">OpenAI-совместимый API (OpenRouter, YandexGPT, DeepSeek, Ollama…)</option>
            </Select>
          </Field>

          <fieldset className="space-y-4 rounded-2xl border border-black/10 p-4">
            <legend className="px-1 text-sm font-semibold">GigaChat (Сбер)</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ключ авторизации" hint="developers.sber.ru → GigaChat API → «Ключ авторизации»">
                <SecretInput name="gigachatAuthKey" masked={maskSecret(ai.gigachatAuthKey)} fromEnv={env.gigachat} />
              </Field>
              <Field label="Модель" hint={gigaModels.error ?? "Список получен из API GigaChat"}>
                <ModelSelect name="gigachatModel" value={ai.gigachatModel} models={gigaModels.models} defaultLabel={`По умолчанию — ${DEFAULT_GIGACHAT_MODEL}`} />
              </Field>
              <Field label="Тип доступа (scope)">
                <Select name="gigachatScope" defaultValue={ai.gigachatScope}>
                  <option value="">Физлицо — GIGACHAT_API_PERS (по умолчанию)</option>
                  <option value="GIGACHAT_API_B2B">ИП/юрлицо, пакеты — GIGACHAT_API_B2B</option>
                  <option value="GIGACHAT_API_CORP">ИП/юрлицо, оплата по факту — GIGACHAT_API_CORP</option>
                </Select>
              </Field>
            </div>
            <div>
              <p className="text-sm font-medium text-stone-700">Остаток токенов</p>
              {balance.items.length ? (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {balance.items.map((b) => (
                    <div key={b.usage} className={`rounded-xl px-3 py-2 ${b.usage === usageGroup ? "bg-emerald-50 ring-1 ring-emerald-600/30" : "bg-stone-100"}`}>
                      <div className="font-semibold tabular-nums">{b.value.toLocaleString("ru-RU")}</div>
                      <div className="text-xs text-stone-500">
                        {b.usage}
                        {b.usage === usageGroup && " · текущая модель"}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-sm text-stone-500">{balance.error ?? "Нет данных"}</p>
              )}
            </div>
          </fieldset>

          <More title="OpenAI-совместимый API" hint="второй провайдер или замена GigaChat" open={ai.provider === "openai" || !!ai.llmApiUrl}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Адрес API" hint="До /chat/completions: OpenRouter — https://openrouter.ai/api/v1, DeepSeek — https://api.deepseek.com/v1">
                <Input name="llmApiUrl" defaultValue={ai.llmApiUrl} placeholder={env.llm ? "Берётся из .env" : ""} />
              </Field>
              <Field label="Ключ API">
                <SecretInput name="llmApiKey" masked={maskSecret(ai.llmApiKey)} />
              </Field>
              <Field label="Модель" hint={ai.llmApiUrl || env.llm ? (llmModels.error ?? `Список из API: ${llmModels.models.length} моделей; можно вписать свою`) : "Сначала укажите адрес и ключ, сохраните — появится список"}>
                <Input name="llmModel" defaultValue={ai.llmModel} list="llm-models" placeholder="Выберите или впишите" />
                <datalist id="llm-models">
                  {llmModels.models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
            </div>
          </More>

          <More title="Нагрузка и лимиты" hint="очередь, запасной провайдер, защита от скриптов" open={loadChanged}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Одновременных запросов к GigaChat" hint="Бесплатный пакет — 1 поток: остальные ждут в очереди, а не получают ошибку. С платным пакетом можно больше.">
                <Input name="concurrency" type="number" min={1} max={10} defaultValue={ai.concurrency} />
              </Field>
              <div className="space-y-2 pt-6">
                <Toggle name="fallback" defaultChecked={ai.fallback} label="При перегрузке — запасной провайдер" />
                <p className="text-xs text-stone-500">Без ИИ помощник всё равно ответит: условия разберут правила, объяснение — по шаблону.</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-stone-700">Лимиты запросов к помощнику</p>
              <p className="mt-0.5 text-xs text-stone-500">С одного адреса могут ходить многие (сеть площадки, офис) — лимит на адрес делайте с запасом. 0 — без ограничения.</p>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="С адреса в минуту">
                  <Input name="rateIpMinute" type="number" min={0} defaultValue={ai.rateIpMinute} />
                </Field>
                <Field label="С адреса в сутки">
                  <Input name="rateIpDay" type="number" min={0} defaultValue={ai.rateIpDay} />
                </Field>
                <Field label="Бот: в минуту">
                  <Input name="rateUserMinute" type="number" min={0} defaultValue={ai.rateUserMinute} />
                </Field>
                <Field label="Бот: в сутки">
                  <Input name="rateUserDay" type="number" min={0} defaultValue={ai.rateUserDay} />
                </Field>
              </div>
            </div>
            {queue.length > 0 && (
              <p className="text-xs text-stone-500">Сейчас: {queue.map((q) => `${q.kind} — в очереди ${q.queued}${q.down ? ", недоступен (пауза 1 мин)" : ""}`).join("; ")}</p>
            )}
          </More>

          <More
            title="Стоимость"
            hint={`${ai.priceRubPer1k} ₽ за 1000 токенов · диалог до ${ai.costDialogRub || "∞"} ₽ · пользователь до ${ai.costUserDayRub || "∞"} ₽ в сутки`}
          >
            <p className="text-xs text-stone-500">
              Токены каждого ответа записываются в трассу (раздел «Аналитика»). Превышен лимит — помощник отвечает без ИИ: условия разбирают правила,
              объяснение — по шаблону. Пользователь — адрес на сайте и в API, аккаунт в боте. 0 — без ограничения; цена 0 — расходы не считаются.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Цена 1000 токенов, ₽" hint="По тарифу провайдера">
                <Input name="priceRubPer1k" type="number" min={0} step="0.01" defaultValue={ai.priceRubPer1k} />
              </Field>
              <Field label="Лимит на диалог, ₽">
                <Input name="costDialogRub" type="number" min={0} step="0.1" defaultValue={ai.costDialogRub} />
              </Field>
              <Field label="Лимит на пользователя в сутки, ₽">
                <Input name="costUserDayRub" type="number" min={0} step="0.1" defaultValue={ai.costUserDayRub} />
              </Field>
            </div>
          </More>

          <More title="Указания помощнику" hint="стиль ответов" open={!!ai.extraPrompt}>
            <Field label="Дополнительные указания" hint="Например: «Отвечай дружелюбно, на «вы». Упоминай Пушкинскую карту, если событие для молодёжи».">
              <Textarea name="extraPrompt" defaultValue={ai.extraPrompt} />
            </Field>
          </More>
        </SettingsForm>
      </Section>
    </>
  );
}
