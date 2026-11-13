import { PageTitle, Section } from "@/components/admin/blocks";
import { ActionButton, Field, Input, SecretInput, SettingsForm, Toggle } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/server/admin";
import { getSettings, maskSecret } from "@/lib/server/settings";
import { saveMail, testMail } from "../../actions";

export default async function AdminMail() {
  await requireAdmin();
  const mail = await getSettings("mail");
  return (
    <>
      <PageTitle
        title="Почта"
        desc="Письма пользователям админки: восстановление пароля, приглашения, уведомления о смене пароля. Без почты пароль восстанавливает администратор."
      />
      <Section>
        <div className="mb-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          Хостинг сервера закрыл почтовые порты (25, 465, 587), поэтому письма уходят через <b>посредника</b> — Cloudflare Worker из{" "}
          <code>docs/mail-relay-worker.js</code>: он сам подключается к SMTP. Без посредника работает только SMTP на порту 2525 (SendPulse, Mailgun, SendGrid).
        </div>
        <SettingsForm action={saveMail} extra={<ActionButton action={testMail}>Отправить тестовое письмо себе</ActionButton>}>
          <Toggle name="enabled" defaultChecked={mail.enabled} label="Отправлять письма" />
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="SMTP-сервер">
              <Input name="host" defaultValue={mail.host} placeholder="smtp.yandex.ru" />
            </Field>
            <Field label="Порт">
              <Input name="port" type="number" min={1} max={65535} defaultValue={mail.port} />
            </Field>
          </div>
          <Toggle name="secure" defaultChecked={mail.secure} label="TLS сразу при подключении (порт 465). Выключено — STARTTLS" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Логин SMTP" hint="Для Яндекса — полный адрес почты">
              <Input name="user" defaultValue={mail.user} autoComplete="off" />
            </Field>
            <Field label="Пароль SMTP">
              <SecretInput name="password" masked={maskSecret(mail.password)} />
            </Field>
            <Field label="Адрес отправителя" hint="Подтверждённый у почтового сервиса">
              <Input name="from" type="email" defaultValue={mail.from} placeholder="noreply@example.ru" />
            </Field>
            <Field label="Имя отправителя">
              <Input name="fromName" defaultValue={mail.fromName} placeholder="Афиша культуры РБ" />
            </Field>
          </div>
          <fieldset className="space-y-4 rounded-2xl border border-black/10 p-4">
            <legend className="px-1 text-sm font-semibold">Посредник (Cloudflare Worker)</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Адрес воркера" hint="Пусто — сервер подключается к SMTP напрямую">
                <Input name="relayUrl" type="url" defaultValue={mail.relayUrl} placeholder="https://afisha-mail.<аккаунт>.workers.dev" />
              </Field>
              <Field label="Секрет" hint="Тот же, что SECRET в настройках воркера">
                <SecretInput name="relaySecret" masked={maskSecret(mail.relaySecret)} />
              </Field>
            </div>
          </fieldset>
        </SettingsForm>
      </Section>
    </>
  );
}
