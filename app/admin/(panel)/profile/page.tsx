import { PageTitle, Section } from "@/components/admin/blocks";
import { Field, Input, SettingsForm } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { mailReady } from "@/lib/server/mail";
import { MIN_PASSWORD_LENGTH, ROLE_LABELS } from "@/lib/server/password";
import { changeOwnPassword, saveOwnEmail } from "../../actions";

export default async function AdminProfile() {
  const me = await requireAdmin("MODERATOR");
  const [user, mail] = await Promise.all([db.adminUser.findUniqueOrThrow({ where: { id: me.id }, select: { email: true } }), mailReady()]);
  return (
    <>
      <PageTitle title="Мой профиль" desc={`${me.login} · ${ROLE_LABELS[me.role]}`} />
      <Section
        title="Почта"
        desc={
          mail ? "Сюда придёт ссылка, если забудете пароль, и уведомление о смене пароля." : "Пригодится для восстановления пароля, когда администратор настроит отправку писем."
        }
      >
        <SettingsForm action={saveOwnEmail}>
          <Field label="Адрес">
            <Input name="email" type="email" defaultValue={user.email ?? ""} autoComplete="email" />
          </Field>
        </SettingsForm>
      </Section>
      <Section title="Смена пароля">
        <SettingsForm action={changeOwnPassword}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Новый пароль" hint={`Не короче ${MIN_PASSWORD_LENGTH} символов`}>
              <Input name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} />
            </Field>
            <Field label="Ещё раз">
              <Input name="password2" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} />
            </Field>
          </div>
        </SettingsForm>
      </Section>
    </>
  );
}
