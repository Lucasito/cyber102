import "server-only";
import nodemailer from "nodemailer";
import { getSettings } from "./settings";

// Письма пользователям админки: восстановление пароля, приглашение, уведомление о смене пароля.
// SMTP — из админки (раздел «Почта»). На сервере исходящие порты 25/465/587 закрыты хостингом,
// поэтому письма идут через посредника — Cloudflare Worker (docs/mail-relay-worker.js).

export async function mailReady() {
  const s = await getSettings("mail");
  return s.enabled && !!s.host && !!s.from;
}

export async function sendMail(to: string, subject: string, text: string) {
  const s = await getSettings("mail");
  if (!s.enabled || !s.host || !s.from) throw new Error("Почта не настроена (раздел «Почта» в админке).");
  if (s.relayUrl) {
    // Через посредника: SMTP-подключение делает Cloudflare Worker, у сервера закрыты почтовые порты
    const res = await fetch(s.relayUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${s.relaySecret}` },
      body: JSON.stringify({ host: s.host, port: s.port, secure: s.secure, user: s.user, pass: s.password, from: s.from, fromName: s.fromName, to, subject, text }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !body?.ok) throw new Error(`Посредник почты: ${body?.error ?? `HTTP ${res.status}`}`);
    return;
  }
  const transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await transport.sendMail({ from: s.fromName ? { name: s.fromName, address: s.from } : s.from, to, subject, text });
}

const SIGN = "\n\n—\nАфиша культуры Башкортостана, управление.\nЕсли письмо пришло по ошибке, просто удалите его.";

export const mailTemplates = {
  reset: (login: string, link: string) => ({
    subject: "Восстановление пароля",
    text: `Здравствуйте, ${login}!\n\nКто-то (возможно, вы) запросил восстановление пароля к управлению афишей.\nЗадать новый пароль: ${link}\n\nСсылка действует 1 час и работает один раз. Если вы не запрашивали восстановление, ничего делать не нужно — пароль остался прежним.${SIGN}`,
  }),
  invite: (login: string, link: string) => ({
    subject: "Доступ к управлению афишей",
    text: `Здравствуйте!\n\nДля вас создан доступ к управлению афишей культуры Башкортостана.\nЛогин: ${login}\nЗадать пароль: ${link}\n\nСсылка действует 24 часа и работает один раз.${SIGN}`,
  }),
  passwordChanged: (login: string) => ({
    subject: "Пароль изменён",
    text: `Здравствуйте, ${login}!\n\nПароль к управлению афишей только что изменён. Если это были не вы — срочно восстановите пароль на странице входа и сообщите администратору.${SIGN}`,
  }),
  organizerApplication: (organization: string, login: string, link: string) => ({
    subject: `Заявка организатора: ${organization}`,
    text: `Новая заявка на доступ к кабинету организатора.

Организация: ${organization}
Логин: ${login}

Рассмотреть: ${link}${SIGN}`,
  }),
  organizerApproved: (login: string, link: string) => ({
    subject: "Заявка организатора одобрена",
    text: `Здравствуйте!

Ваша заявка одобрена — кабинет организатора афиши культуры Башкортостана открыт.
Логин: ${login}
Войти: ${link}

В кабинете можно добавлять события по одному или файлом; каждое проверяет модератор.${SIGN}`,
  }),
  organizerRejected: (organization: string) => ({
    subject: "Заявка организатора отклонена",
    text: `Здравствуйте!

К сожалению, заявка «${organization}» на доступ к кабинету организатора отклонена. Если это ошибка, напишите через форму обратной связи на сайте афиши.${SIGN}`,
  }),
  test: () => ({ subject: "Проверка почты", text: `Это тестовое письмо: почта для управления афишей настроена правильно.${SIGN}` }),
};

/** Отправить письмо, не роняя основное действие: ошибка уходит в лог. */
export async function sendMailQuietly(to: string | null | undefined, mail: { subject: string; text: string }) {
  if (!to || !(await mailReady())) return false;
  try {
    await sendMail(to, mail.subject, mail.text);
    return true;
  } catch (e) {
    console.error(JSON.stringify({ event: "mail_failed", error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
