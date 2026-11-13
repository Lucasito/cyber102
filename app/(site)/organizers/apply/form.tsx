"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, useState } from "react";
import { applyOrganizer } from "./actions";

const inputCls = "mt-1 w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-black/10 outline-none focus:ring-2 focus:ring-[var(--brand)]";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export function ApplyForm({ minPassword }: { minPassword: number }) {
  const [state, action, pending] = useActionState(applyOrganizer, null);
  const [started] = useState(() => Date.now());
  if (state?.ok)
    return (
      <p className="rounded-2xl bg-emerald-50 p-4 text-emerald-800" role="status">
        {state.message}
      </p>
    );
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="started" value={started} />
      {/* Ловушка для ботов: людям не видна */}
      <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
        <label>
          Сайт <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Учреждение или организация *">
          <input name="organization" required maxLength={200} className={inputCls} placeholder="Башкирская государственная филармония" />
        </Field>
        <Field label="Контактное лицо *">
          <input name="name" required maxLength={100} autoComplete="name" className={inputCls} />
        </Field>
        <Field label="Почта *" hint="Сюда придёт решение по заявке">
          <input name="email" type="email" required maxLength={150} autoComplete="email" className={inputCls} />
        </Field>
        <Field label="Телефон" hint="По желанию — если модератору понадобится уточнить">
          <input name="phone" type="tel" maxLength={40} autoComplete="tel" className={inputCls} />
        </Field>
      </div>
      <Field label="Сайт учреждения" hint="Поможет модератору убедиться, что заявка от вас">
        <input name="site" type="url" maxLength={300} placeholder="https://…" className={inputCls} />
      </Field>
      <Field label="Что будете размещать">
        <textarea name="note" rows={3} maxLength={1000} className={inputCls} placeholder="Например: спектакли и концерты нашего театра, 10–15 событий в месяц" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Логин *" hint="Латиница в нижнем регистре, цифры, точка, дефис">
          <input name="login" required pattern="[a-z0-9._\-]{3,32}" autoComplete="username" className={inputCls} />
        </Field>
        <Field label="Пароль *" hint={`Не короче ${minPassword} символов`}>
          <input name="password" type="password" required minLength={minPassword} autoComplete="new-password" className={inputCls} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm text-stone-600">
        <input type="checkbox" name="consent" required className="mt-1 accent-[var(--brand)]" />
        <span>
          Согласен на обработку указанных персональных данных (имя, почта, телефон) для рассмотрения заявки и работы в кабинете организатора. Данные
          хранятся, пока действует учётная запись; при отклонении заявки — удаляются.
        </span>
      </label>
      {state && !state.ok && (
        <p className="text-sm text-red-600" role="alert">
          {state.message}
        </p>
      )}
      <button disabled={pending} className="inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {pending && <LoaderCircle className="size-4 animate-spin" />} Отправить заявку
      </button>
    </form>
  );
}
