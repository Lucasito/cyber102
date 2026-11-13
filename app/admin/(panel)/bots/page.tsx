import { More, PageTitle, Section } from "@/components/admin/blocks";
import { ActionButton, Field, Input, SecretInput, Select, SettingsForm, Textarea, Toggle } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/server/admin";
import { DEFAULT_BOT_GREETING, getSettings, maskSecret } from "@/lib/server/settings";
import { telegramDeleteWebhookUrl, telegramSetWebhookUrl } from "@/lib/server/telegram";
import { envFallbacks, saveMax, saveTelegram, testMax, testTelegram } from "../../actions";

export default async function AdminBots() {
  await requireAdmin();
  const [max, tg, env] = await Promise.all([getSettings("max"), getSettings("telegram"), envFallbacks()]);
  const tgToken = tg.token || process.env.TELEGRAM_BOT_TOKEN || "";
  return (
    <>
      <PageTitle title="Боты" desc="Помощник в мессенджерах MAX и Telegram. Изменения применяются сразу." />
      <Section title="MAX" desc="business.max.ru → Чат-боты. Работает через опрос сервера MAX.">
        <SettingsForm action={saveMax} extra={<ActionButton action={testMax}>Проверить бота</ActionButton>}>
          <Toggle name="enabled" defaultChecked={max.enabled} label="Бот включён" />
          <Field label="Токен">
            <SecretInput name="token" masked={maskSecret(max.token)} fromEnv={env.maxToken} />
          </Field>
          <More title="Приветствие" open={!!max.greeting}>
            <Field label="Текст" hint="Отправляется при запуске бота и на команду /start. Пусто — текст по умолчанию.">
              <Textarea name="greeting" defaultValue={max.greeting} placeholder={DEFAULT_BOT_GREETING} />
            </Field>
          </More>
        </SettingsForm>
      </Section>

      <Section title="Telegram" desc="@BotFather → /newbot. С серверов в РФ api.telegram.org заблокирован — бот ходит через прокси-адрес API.">
        <SettingsForm action={saveTelegram} extra={<ActionButton action={testTelegram}>Проверить бота</ActionButton>}>
          <Toggle name="enabled" defaultChecked={tg.enabled} label="Бот включён" />
          <Field label="Токен">
            <SecretInput name="token" masked={maskSecret(tg.token)} fromEnv={env.tgToken} />
          </Field>
          <More title="Подключение" hint="режим и адрес API" open={tg.mode === "webhook" || !tg.apiUrl}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Режим">
                <Select name="mode" defaultValue={tg.mode}>
                  <option value="polling">Опрос (нужен доступ к API Telegram)</option>
                  <option value="webhook">Webhook (Telegram сам присылает сообщения)</option>
                </Select>
              </Field>
              <Field label="Адрес API Telegram" hint={<>Зеркало api.telegram.org на Cloudflare Workers (<a href="/admin/files/telegram-proxy-worker.js" className="underline">скачать код воркера</a>, инструкция — в начале файла). Пусто — https://api.telegram.org (с сервера в РФ недоступен)</>}>
                <Input name="apiUrl" defaultValue={tg.apiUrl} placeholder="https://api.telegram.org" />
              </Field>
            </div>
          </More>
          <More title="Приветствие" open={!!tg.greeting}>
            <Field label="Текст" hint="Ответ на /start. Пусто — текст по умолчанию.">
              <Textarea name="greeting" defaultValue={tg.greeting} placeholder={DEFAULT_BOT_GREETING} />
            </Field>
          </More>
        </SettingsForm>
        {tgToken && tg.mode === "webhook" && (
          <div className="mt-5 rounded-2xl bg-stone-100 p-4 text-sm">
            <p className="font-medium">Подключение webhook</p>
            <p className="mt-1 text-stone-600">
              Сервер не может сам обратиться к Telegram, поэтому откройте ссылку в своём браузере (где Telegram доступен) — Telegram ответит <code>&quot;ok&quot;: true</code>.
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
    </>
  );
}
