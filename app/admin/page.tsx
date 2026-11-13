import Link from "next/link";
import { ActionButton, Field, Input, SecretInput, Select, SettingsForm, Textarea, Toggle } from "@/components/admin/ui";
import { DEMO_SOURCE } from "@/lib/demo-data";
import { aiProviderName, aiQueueStats, DEFAULT_GIGACHAT_MODEL, gigachatBalance, gigachatUsageGroup, listModels } from "@/lib/server/ai";
import { analyticsSummary } from "@/lib/server/analytics";
import { db } from "@/lib/server/db";
import { DEFAULT_BOT_GREETING, DEFAULT_EXAMPLES, DEFAULT_HERO_SUBTITLE, DEFAULT_HERO_TITLE, getSettings, maskSecret, settingsSchema, type Settings } from "@/lib/server/settings";
import { CLARIFY_SUGGESTIONS, CLARIFY_TEXT, FOLLOWUP_SUGGESTIONS } from "@/lib/server/agent";
import { telegramDeleteWebhookUrl, telegramSetWebhookUrl } from "@/lib/server/telegram";
import { envFallbacks, loadDemo, logout, removeDemo, resetTuning, saveAi, saveMap, saveMax, saveSite, saveTelegram, saveTuning, testAi, testMax, testTelegram } from "./actions";

const SECTIONS = [
  ["overview", "Обзор"],
  ["site", "Сайт"],
  ["ai", "ИИ"],
  ["max", "Бот MAX"],
  ["telegram", "Бот Telegram"],
  ["map", "Карта"],
  ["tuning", "Параметры"],
  ["analytics", "Аналитика"],
  ["data", "Данные"],
] as const;

function Section({ id, title, desc, children }: { id: string; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-3xl bg-white p-5 ring-1 ring-black/5 sm:p-7">
      <h2 className="text-lg font-semibold">{title}</h2>
      {desc && <p className="mt-1 text-sm text-stone-500">{desc}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Поля раздела «Параметры»: ключ настройки, подпись, единица, шаг. Значение по умолчанию — из схемы. */
const TUNING_GROUPS: { title: string; fields: [keyof Settings<"tuning">, string, string, number][] }[] = [
  {
    title: "ИИ",
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
    fields: [
      ["botEvents", "Событий в ответе бота", "шт.", 1],
      ["remindHours", "Напоминать до начала за", "ч", 1],
      ["remindFallbackHours", "Если до начала меньше — за", "ч", 0.5],
      ["exhibitionRemindDays", "Выставка: до закрытия за", "дней", 1],
    ],
  },
];

/** Выбор модели из списка; текущее значение сохраняется, даже если его нет в списке. */
function ModelSelect({ name, value, models, defaultLabel }: { name: string; value: string; models: string[]; defaultLabel: string }) {
  const options = value && !models.includes(value) ? [value, ...models] : models;
  return (
    <Select name={name} defaultValue={value}>
      <option value="">{defaultLabel}</option>
      {options.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </Select>
  );
}

function QueryList({ items, empty }: { items: { text: string; count: number }[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-stone-500">{empty}</p>;
  return (
    <ol className="space-y-1 text-sm">
      {items.map((q) => (
        <li key={q.text} className="flex justify-between gap-4 rounded-lg bg-stone-100 px-3 py-1.5">
          <span className="min-w-0 truncate">{q.text}</span>
          <b className="shrink-0 tabular-nums">{q.count}</b>
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-stone-100 p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-sm text-stone-500">{label}</div>
    </div>
  );
}

export default async function AdminPage() {
  const now = new Date();
  const [site, ai, max, tg, env, provider, total, upcoming, demo, users, [gigaModels, balance], llmModels, stats, reminders, tuning, mapSettings] = await Promise.all([
    getSettings("site"),
    getSettings("ai"),
    getSettings("max"),
    getSettings("telegram"),
    envFallbacks(),
    aiProviderName(),
    db.event.count(),
    db.event.count({ where: { status: { not: "PAST" }, OR: [{ startsAt: { gte: now } }, { endsAt: { gte: now } }] } }),
    db.event.count({ where: { sources: { some: { source: DEMO_SOURCE } } } }),
    db.botUser.groupBy({ by: ["platform"], _count: true, _sum: { messages: true } }),
    // К GigaChat — по очереди: на параллельные запросы он отвечает 429
    (async () => [await listModels("gigachat"), await gigachatBalance()] as const)(),
    listModels("openai"),
    getSettings("tuning").then((t) => analyticsSummary(t.analyticsDays)),
    db.reminder.count({ where: { sentAt: null } }),
    getSettings("tuning"),
    getSettings("map"),
  ]);
  const tuningDefaults = settingsSchema.tuning.parse({});
  const queue = aiQueueStats();
  const maxDay = Math.max(1, ...stats.byDay.map((d) => d.count));
  const SOURCE_LABELS: Record<string, string> = { site: "Сайт", api: "API", max: "MAX", telegram: "Telegram" };
  const usageGroup = balance.model ? gigachatUsageGroup(balance.model) : null;
  const currentBalance = balance.items.find((b) => b.usage === usageGroup);
  const botStat = (p: string) => users.find((u) => u.platform === p);
  const tgToken = tg.token || process.env.TELEGRAM_BOT_TOKEN || "";

  return (
    <div className="min-h-dvh bg-[#f7f6f3]">
      <header className="sticky top-0 z-20 border-b border-black/5 bg-[#f7f6f3]/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4">
          <span className="shrink-0 font-semibold whitespace-nowrap">Управление</span>
          <nav className="no-scrollbar ml-2 hidden min-w-0 flex-1 gap-0.5 overflow-x-auto text-sm md:flex">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="shrink-0 rounded-full px-2.5 py-1 whitespace-nowrap text-stone-600 hover:bg-black/5">
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-3 text-sm whitespace-nowrap">
            <Link href="/" className="text-stone-500 hover:text-stone-900">
              На сайт
            </Link>
            <form action={logout}>
              <button className="text-stone-500 hover:text-stone-900">Выйти</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <Section id="overview" title="Обзор">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="актуальных событий" value={upcoming} />
            <Stat label="всего в базе" value={total} />
            <Stat label="пользователей MAX" value={botStat("max")?._count ?? 0} />
            <Stat label="пользователей Telegram" value={botStat("telegram")?._count ?? 0} />
          </div>
          <p className="mt-4 text-sm text-stone-500">
            ИИ: <b className="text-stone-800">{provider ?? "выключен"}</b>
            {currentBalance && provider?.startsWith("gigachat") && (
              <>
                {" "}
                · осталось токенов: <b className="text-stone-800">{currentBalance.value.toLocaleString("ru-RU")}</b>
              </>
            )}
            {demo > 0 && (
              <>
                {" "}
                · тестовых событий: <b className="text-amber-700">{demo}</b>
              </>
            )}
          </p>
        </Section>

        <Section id="site" title="Сайт" desc="Тексты главной страницы и объявления. Пустое поле — текст по умолчанию.">
          <SettingsForm action={saveSite}>
            <Field label="Заголовок">
              <Input name="heroTitle" defaultValue={site.heroTitle} placeholder={DEFAULT_HERO_TITLE} />
            </Field>
            <Field label="Подзаголовок">
              <Textarea name="heroSubtitle" defaultValue={site.heroSubtitle} placeholder={DEFAULT_HERO_SUBTITLE} />
            </Field>
            <Field label="Примеры запросов под строкой поиска" hint="По одному в строке, до шести.">
              <Textarea name="examples" rows={4} defaultValue={site.examples.join("\n")} placeholder={DEFAULT_EXAMPLES.join("\n")} />
            </Field>
            <Field label="Объявление над шапкой" hint="Например, о технических работах. Пусто — не показывать.">
              <Input name="notice" defaultValue={site.notice} />
            </Field>
            <Toggle name="testBanner" defaultChecked={site.testBanner} label="Показывать плашку «Тестовые данные», пока в базе есть тестовые события" />
          </SettingsForm>
        </Section>

        <Section id="ai" title="ИИ-помощник" desc="Модель для умного поиска на сайте и в ботах. Изменения применяются сразу.">
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
                <Field label="Тип доступа (scope)">
                  <Select name="gigachatScope" defaultValue={ai.gigachatScope}>
                    <option value="">Физлицо — GIGACHAT_API_PERS (по умолчанию)</option>
                    <option value="GIGACHAT_API_B2B">ИП/юрлицо, пакеты — GIGACHAT_API_B2B</option>
                    <option value="GIGACHAT_API_CORP">ИП/юрлицо, оплата по факту — GIGACHAT_API_CORP</option>
                  </Select>
                </Field>
                <Field label="Модель" hint={gigaModels.error ?? "Список получен из API GigaChat"}>
                  <ModelSelect name="gigachatModel" value={ai.gigachatModel} models={gigaModels.models} defaultLabel={`По умолчанию — ${DEFAULT_GIGACHAT_MODEL}`} />
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
                <p className="mt-1 text-xs text-stone-500">Данные GigaChat, обновляются раз в минуту. Модели одной группы (например, GigaChat-3-Ultra) тратят общий лимит.</p>
              </div>
            </fieldset>
            <fieldset className="space-y-4 rounded-2xl border border-black/10 p-4">
              <legend className="px-1 text-sm font-semibold">OpenAI-совместимый API</legend>
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
            </fieldset>
            <fieldset className="space-y-4 rounded-2xl border border-black/10 p-4">
              <legend className="px-1 text-sm font-semibold">Нагрузка</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Одновременных запросов к GigaChat"
                  hint="Бесплатный пакет — 1 поток: остальные запросы ждут в очереди, а не получают ошибку «слишком много запросов». С платным пакетом можно больше."
                >
                  <Input name="concurrency" type="number" min={1} max={10} defaultValue={ai.concurrency} />
                </Field>
                <div className="space-y-2 pt-6">
                  <Toggle name="fallback" defaultChecked={ai.fallback} label="При перегрузке — запасной провайдер" />
                  <p className="text-xs text-stone-500">
                    Если основной не ответил после повторов, запрос уйдёт второму (если он настроен). Без ИИ помощник всё равно ответит: условия разберут правила, объяснение — по шаблону.
                  </p>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-stone-700">Лимиты запросов к помощнику</p>
                <p className="mt-0.5 text-xs text-stone-500">
                  Защита токенов ИИ от скриптов. С одного адреса могут ходить многие (сеть площадки, офис) — лимит на адрес делайте с запасом. 0 — без
                  ограничения.
                </p>
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
                <p className="text-xs text-stone-500">
                  Сейчас: {queue.map((q) => `${q.kind} — в очереди ${q.queued}${q.down ? ", недоступен (пауза 1 мин)" : ""}`).join("; ")}
                </p>
              )}
            </fieldset>
            <Field label="Дополнительные указания помощнику" hint="Например: «Отвечай дружелюбно, на «вы». Упоминай Пушкинскую карту, если событие для молодёжи».">
              <Textarea name="extraPrompt" defaultValue={ai.extraPrompt} />
            </Field>
          </SettingsForm>
        </Section>

        <Section id="max" title="Бот MAX" desc="business.max.ru → Чат-боты. Работает через опрос сервера MAX, изменения применяются сразу.">
          <SettingsForm action={saveMax} extra={<ActionButton action={testMax}>Проверить бота</ActionButton>}>
            <Toggle name="enabled" defaultChecked={max.enabled} label="Бот включён" />
            <Field label="Токен">
              <SecretInput name="token" masked={maskSecret(max.token)} fromEnv={env.maxToken} />
            </Field>
            <Field label="Приветствие" hint="Отправляется при запуске бота и на команду /start.">
              <Textarea name="greeting" defaultValue={max.greeting} placeholder={DEFAULT_BOT_GREETING} />
            </Field>
          </SettingsForm>
        </Section>

        <Section id="telegram" title="Бот Telegram" desc="@BotFather → /newbot. С серверов в РФ api.telegram.org заблокирован — нужен прокси-адрес API или режим webhook.">
          <SettingsForm action={saveTelegram} extra={<ActionButton action={testTelegram}>Проверить бота</ActionButton>}>
            <Toggle name="enabled" defaultChecked={tg.enabled} label="Бот включён" />
            <Field label="Токен">
              <SecretInput name="token" masked={maskSecret(tg.token)} fromEnv={env.tgToken} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Режим">
                <Select name="mode" defaultValue={tg.mode}>
                  <option value="polling">Опрос (нужен доступ к API Telegram)</option>
                  <option value="webhook">Webhook (Telegram сам присылает сообщения)</option>
                </Select>
              </Field>
              <Field label="Адрес API Telegram" hint="Зеркало api.telegram.org — Cloudflare Worker из docs/telegram-proxy-worker.js. Пусто — https://api.telegram.org (с сервера в РФ недоступен)">
                <Input name="apiUrl" defaultValue={tg.apiUrl} placeholder="https://api.telegram.org" />
              </Field>
            </div>
            <Field label="Приветствие" hint="Ответ на /start.">
              <Textarea name="greeting" defaultValue={tg.greeting} placeholder={DEFAULT_BOT_GREETING} />
            </Field>
          </SettingsForm>
          {tgToken && tg.mode === "webhook" && (
            <div className="mt-5 rounded-2xl bg-stone-100 p-4 text-sm">
              <p className="font-medium">Подключение webhook</p>
              <p className="mt-1 text-stone-600">
                Сервер не может сам обратиться к Telegram, поэтому откройте ссылку в своём браузере (где Telegram доступен) — Telegram ответит{" "}
                <code>&quot;ok&quot;: true</code>. Ответы бот отправляет в ответе на webhook, исходящий доступ не нужен.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <a href={telegramSetWebhookUrl(tgToken)} target="_blank" rel="noreferrer" className="rounded-full bg-stone-900 px-4 py-2 font-medium text-white hover:bg-stone-700">
                  Подключить webhook
                </a>
                <a href={telegramDeleteWebhookUrl(tgToken)} target="_blank" rel="noreferrer" className="rounded-full bg-white px-4 py-2 font-medium ring-1 ring-black/10">
                  Отключить webhook
                </a>
              </div>
            </div>
          )}
        </Section>

        <Section id="map" title="Карта" desc="Карта на сайте: вид «На карте» и «Как добраться» на странице события.">
          <SettingsForm action={saveMap}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Карта">
                <Select name="provider" defaultValue={mapSettings.provider}>
                  <option value="osm">OpenStreetMap (бесплатно, без ключа)</option>
                  <option value="yandex">Яндекс Карты (нужен ключ)</option>
                </Select>
              </Field>
              <Field
                label="Ключ JavaScript API Яндекс Карт"
                hint="developer.tech.yandex.ru → «JavaScript API и HTTP Геокодер». Ключ виден в браузере — в кабинете Яндекса ограничьте его адресом сайта (HTTP Referer)."
              >
                <SecretInput name="yandexKey" masked={maskSecret(mapSettings.yandexKey)} />
              </Field>
            </div>
            <p className="text-xs text-stone-500">Сейчас на сайте: {mapSettings.provider === "yandex" && mapSettings.yandexKey ? "Яндекс Карты" : "OpenStreetMap"}. Если ключ Яндекса не подойдёт, сайт сам покажет OpenStreetMap.</p>
          </SettingsForm>
        </Section>

        <Section id="tuning" title="Параметры" desc="Числа, от которых зависит работа помощника, ботов и сайта. Пустое поле — значение по умолчанию. Применяются сразу.">
          <SettingsForm action={saveTuning} extra={<ActionButton action={resetTuning} confirm="Вернуть все параметры к значениям по умолчанию?">Вернуть по умолчанию</ActionButton>}>
            {TUNING_GROUPS.map((g) => (
              <fieldset key={g.title} className="rounded-2xl border border-black/10 p-4">
                <legend className="px-1 text-sm font-semibold">{g.title}</legend>
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.fields.map(([key, label, unit, step]) => (
                    <Field key={key} label={label} hint={`${unit ? `${unit} · ` : ""}по умолчанию ${tuningDefaults[key]}`}>
                      <Input name={key} type="number" step={step} min={0} defaultValue={String(tuning[key])} />
                    </Field>
                  ))}
                </div>
              </fieldset>
            ))}
            <fieldset className="space-y-4 rounded-2xl border border-black/10 p-4">
              <legend className="px-1 text-sm font-semibold">Тексты помощника</legend>
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
            </fieldset>
          </SettingsForm>
        </Section>

        <Section id="analytics" title={`Аналитика за ${stats.days} дн.`} desc="Запросы к умному помощнику на сайте, через API и в ботах.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="запросов" value={stats.total} />
            <Stat label="с уточнением" value={stats.clarified} />
            <Stat label="ответов без ИИ" value={stats.degraded} />
            <Stat label="ждут напоминаний" value={reminders} />
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-[2fr_1fr]">
            <div>
              <p className="mb-2 text-sm font-medium text-stone-700">По дням</p>
              <div className="flex h-32 items-end gap-2">
                {stats.byDay.map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-xs tabular-nums text-stone-500">{d.count || ""}</span>
                    <div className="w-full rounded-t-md bg-[var(--brand)]/80" style={{ height: `${(d.count / maxDay) * 88}px`, minHeight: d.count ? 4 : 1 }} />
                    <span className="text-[11px] text-stone-500">{d.day.slice(8)}.{d.day.slice(5, 7)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-stone-700">Откуда</p>
              {Object.keys(stats.bySource).length ? (
                <ul className="space-y-1 text-sm">
                  {Object.entries(stats.bySource)
                    .sort((a, b) => b[1] - a[1])
                    .map(([s, n]) => (
                      <li key={s} className="flex justify-between gap-4">
                        <span>{SOURCE_LABELS[s] ?? s}</span>
                        <b className="tabular-nums">{n}</b>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-sm text-stone-500">Пока нет запросов</p>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium text-stone-700">Популярные запросы</p>
              <QueryList items={stats.top} empty="Пока нет запросов" />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-stone-700">Чего не хватает в афише</p>
              <p className="mb-2 text-xs text-stone-500">Ничего не нашлось или пришлось показать похожее — подсказка, какие события стоит добавить.</p>
              <QueryList items={stats.missed} empty="Всё находится" />
            </div>
          </div>
        </Section>

        <Section id="data" title="Данные" desc="Тестовые события помечены источником demo. Пока они есть, на сайте видна плашка «Тестовые данные» (если включена).">
          <div className="flex flex-wrap gap-4">
            <ActionButton action={loadDemo} confirm="Пересоздать тестовые события с датами от сегодняшнего дня?">
              Загрузить тестовые данные
            </ActionButton>
            <ActionButton action={removeDemo} confirm="Удалить все тестовые события?">
              Удалить тестовые данные
            </ActionButton>
          </div>
        </Section>
      </main>
    </div>
  );
}
