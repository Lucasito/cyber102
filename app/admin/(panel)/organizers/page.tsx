import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { ActionButton, Field, Input, SettingsForm } from "@/components/admin/ui";
import { approveOrganizer, createOrganizer, rejectOrganizer, sendOrganizerResetLink, setOrganizerActive } from "@/app/admin/actions";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { mailReady } from "@/lib/server/mail";

/** Организаторы: приглашает и отключает модератор. Их события — в «Модерации». */
export default async function Organizers() {
  await requireAdmin("MODERATOR");
  const [applications, users, mail] = await Promise.all([
    db.adminUser.findMany({
      where: { role: "ORGANIZER", pendingApproval: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, login: true, name: true, email: true, phone: true, website: true, organization: true, applicationNote: true, createdAt: true },
    }),
    db.adminUser.findMany({
      where: { role: "ORGANIZER", pendingApproval: false },
      orderBy: [{ active: "desc" }, { login: "asc" }],
      select: { id: true, login: true, name: true, email: true, organization: true, active: true, lastLoginAt: true, _count: { select: { events: true } } },
    }),
    mailReady(),
  ]);
  const pending = await db.event.groupBy({ by: ["createdById"], where: { createdById: { in: users.map((u) => u.id) }, needsReview: true }, _count: true });
  const pendingBy = new Map(pending.map((p) => [p.createdById, p._count]));
  return (
    <>
      <PageTitle
        title="Организаторы"
        desc={
          <>
            Учреждения и компании, которые сами добавляют события — по одному или файлом. Всё, что они присылают, попадает в{" "}
            <Link href="/admin/moderation" className="underline">
              «Модерацию»
            </Link>
            ; уже опубликованные события организатор изменить не может. Учреждению с сайтом лучше подключить ленту — раздел{" "}
            <Link href="/admin/sources" className="underline">
              «Источники»
            </Link>
            .
          </>
        }
      />
      <Section
        title={`Заявки с сайта${applications.length ? ` — ${applications.length}` : ""}`}
        desc={
          <>
            Организации подают заявку на странице{" "}
            <Link href="/organizers/apply" className="underline">
              /organizers/apply
            </Link>
            . Одобрили — вход открывается и уходит письмо; отклонили — учётная запись и данные заявителя удаляются.
          </>
        }
      >
        {applications.length ? (
          <ul className="divide-y divide-black/5">
            {applications.map((a) => (
              <li key={a.id} className="space-y-2 py-3">
                <div>
                  <p className="font-medium">{a.organization}</p>
                  <p className="text-xs text-stone-500">
                    {a.name} · {a.email}
                    {a.phone && ` · ${a.phone}`} · логин {a.login} · {a.createdAt.toLocaleString("ru-RU", { timeZone: "Asia/Yekaterinburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                  {a.website && (
                    <a href={a.website} target="_blank" rel="noreferrer" className="text-xs break-all text-[var(--brand)] underline">
                      {a.website}
                    </a>
                  )}
                  {a.applicationNote && <p className="mt-1 text-sm text-stone-600">{a.applicationNote}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <ActionButton action={approveOrganizer.bind(null, a.id)}>Одобрить</ActionButton>
                  <ActionButton action={rejectOrganizer.bind(null, a.id)} confirm={`Отклонить заявку «${a.organization}»? Данные заявителя будут удалены.`}>
                    Отклонить
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Новых заявок нет.</p>
        )}
      </Section>
      <Section title="Пригласить организатора">
        <SettingsForm action={createOrganizer} submitLabel="Пригласить">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Учреждение или организация">
              <Input name="organization" required placeholder="Башкирская государственная филармония" />
            </Field>
            <Field label="Контактное лицо">
              <Input name="name" placeholder="Имя и фамилия" />
            </Field>
            <Field label="Логин" hint="Латиница в нижнем регистре, цифры, точка, дефис">
              <Input name="login" required pattern="[a-z0-9._\-]{3,32}" placeholder="bashgf" />
            </Field>
            <Field label="Почта" hint={mail ? "Придёт письмо со ссылкой — пароль организатор задаст сам" : "Почта в админке не настроена — пароль покажем здесь"}>
              <Input name="email" type="email" placeholder="afisha@example.org" />
            </Field>
          </div>
        </SettingsForm>
      </Section>
      <Section>
        {users.length ? (
          <ul className="divide-y divide-black/5">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className={`font-medium ${u.active ? "" : "text-stone-400"}`}>
                    {u.organization ?? u.login}
                    {!u.active && <span className="ml-2 text-xs font-normal">отключён</span>}
                  </p>
                  <p className="text-xs text-stone-500">
                    {u.login}
                    {u.name && ` · ${u.name}`}
                    {u.email && ` · ${u.email}`} · событий {u._count.events}
                    {pendingBy.get(u.id) ? `, на модерации ${pendingBy.get(u.id)}` : ""}
                    {u.lastLoginAt && ` · входил ${u.lastLoginAt.toLocaleDateString("ru-RU", { timeZone: "Asia/Yekaterinburg" })}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {u.email && u.active && mail && <ActionButton action={sendOrganizerResetLink.bind(null, u.id)}>Ссылка для пароля</ActionButton>}
                  <ActionButton
                    action={setOrganizerActive.bind(null, u.id, !u.active)}
                    confirm={u.active ? `Отключить ${u.login}? Он сразу выйдет из кабинета.` : undefined}
                  >
                    {u.active ? "Отключить" : "Включить"}
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Организаторов пока нет.</p>
        )}
      </Section>
    </>
  );
}
