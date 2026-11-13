import { PageTitle, Section } from "@/components/admin/blocks";
import { ActionButton, Field, Input, Select, SettingsForm, Toggle } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { MIN_PASSWORD_LENGTH, ROLE_LABELS } from "@/lib/server/password";
import { mailReady } from "@/lib/server/mail";
import { createUser, deleteUser, resetUserPassword, sendUserResetLink, updateUser } from "../../actions";

const fmt = (d: Date | null) => (d ? d.toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg", dateStyle: "short", timeStyle: "short" }) : "не входил");

function RoleSelect({ value }: { value: string }) {
  return (
    <Select name="role" defaultValue={value}>
      {Object.entries(ROLE_LABELS).map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </Select>
  );
}

export default async function AdminUsersPage() {
  const me = await requireAdmin();
  const now = new Date();
  const [users, mail] = await Promise.all([db.adminUser.findMany({ orderBy: [{ role: "asc" }, { login: "asc" }] }), mailReady()]);

  return (
    <>
      <PageTitle
        title="Пользователи"
        desc={`${ROLE_LABELS.ADMIN} — все разделы, настройки и пользователи. ${ROLE_LABELS.MODERATOR} — работа с событиями: импорт, правка, модерация, источники, организаторы. ${ROLE_LABELS.ORGANIZER} — только свои события: добавляет по одному или файлом, всё проходит модерацию.`}
      />
      <Section>
        <ul className="space-y-3">
          {users.map((u) => (
            <li key={u.id} className={`rounded-2xl p-4 ring-1 ring-black/5 ${u.active ? "bg-stone-50" : "bg-stone-100 opacity-70"}`}>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <b>{u.login}</b>
                <span className="text-sm text-stone-500">{ROLE_LABELS[u.role]}</span>
                {!u.active && <span className="text-sm text-red-600">доступ отключён</span>}
                {u.lockedUntil && u.lockedUntil > now && (
                  <span className="text-sm text-amber-700" title="Сохранение карточки или новый пароль снимают блокировку">
                    вход закрыт до {fmt(u.lockedUntil)} после неудачных попыток
                  </span>
                )}
                {u.id === me.id && <span className="text-sm text-emerald-700">это вы</span>}
                <span className="ml-auto text-xs text-stone-500">последний вход: {fmt(u.lastLoginAt)}</span>
              </div>
              <SettingsForm
                action={updateUser}
                extra={
                  u.id !== me.id && (
                    <>
                      {mail && u.email && (
                        <ActionButton action={sendUserResetLink.bind(null, u.id)} confirm={`Отправить ${u.login} на ${u.email} ссылку для нового пароля?`}>
                          Ссылка на почту
                        </ActionButton>
                      )}
                      <ActionButton action={resetUserPassword.bind(null, u.id)} confirm={`Сгенерировать новый пароль для ${u.login}? Старый перестанет работать.`}>
                        Новый пароль
                      </ActionButton>
                      <ActionButton action={deleteUser.bind(null, u.id)} confirm={`Удалить пользователя ${u.login}?`}>
                        Удалить
                      </ActionButton>
                    </>
                  )
                }
              >
                <input type="hidden" name="id" value={u.id} />
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                  <Field label="Имя">
                    <Input name="name" defaultValue={u.name ?? ""} placeholder="Как обращаться" />
                  </Field>
                  <Field label="Почта">
                    <Input name="email" type="email" defaultValue={u.email ?? ""} placeholder="для восстановления пароля" />
                  </Field>
                  <Field label="Роль">
                    <RoleSelect value={u.role} />
                  </Field>
                  <div className="pb-2">
                    <Toggle name="active" defaultChecked={u.active} label="Доступ" />
                  </div>
                </div>
              </SettingsForm>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Новый пользователь">
        <p className="mt-1 text-sm text-stone-500">
          {mail ? "С почтой и галочкой «Пригласить» пользователь сам задаст пароль по ссылке из письма. " : ""}Пустой пароль — сгенерируется и покажется один раз после создания.
        </p>
        <div className="mt-5">
          <SettingsForm action={createUser}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Логин" hint="Латиница в нижнем регистре, цифры, . _ -">
                <Input name="login" required autoComplete="off" pattern="[a-z0-9._\-]{3,32}" />
              </Field>
              <Field label="Имя">
                <Input name="name" autoComplete="off" />
              </Field>
              <Field label="Роль">
                <RoleSelect value="MODERATOR" />
              </Field>
              <Field label="Почта">
                <Input name="email" type="email" autoComplete="off" />
              </Field>
              <Field label="Пароль" hint={`Не короче ${MIN_PASSWORD_LENGTH} символов`}>
                <Input name="password" type="password" autoComplete="new-password" />
              </Field>
            </div>
            {mail && <Toggle name="invite" defaultChecked label="Пригласить: отправить на почту ссылку для пароля (поле «Пароль» не нужно)" />}
          </SettingsForm>
        </div>
      </Section>
    </>
  );
}
