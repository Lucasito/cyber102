"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { forgotPassword, setPasswordByToken } from "./actions";

const inputCls = "mt-1 w-full rounded-xl bg-stone-100 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--brand)]";
const btnCls = "inline-flex w-full items-center justify-center gap-2 rounded-full bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50";

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotPassword, null);
  if (state?.ok)
    return (
      <div className="space-y-4">
        <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
          {state.message}
        </p>
        <Link href="/admin/login" className="block text-center text-sm text-stone-500 hover:text-stone-900">
          ← Ко входу
        </Link>
      </div>
    );
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-stone-700">Логин или почта</span>
        <input name="who" required autoFocus autoComplete="username" className={inputCls} />
      </label>
      {state && (
        <p className="text-sm text-red-600" role="alert">
          {state.message}
        </p>
      )}
      <button disabled={pending} className={btnCls}>
        {pending && <LoaderCircle className="size-4 animate-spin" />} Отправить ссылку
      </button>
      <Link href="/admin/login" className="block text-center text-sm text-stone-500 hover:text-stone-900">
        ← Ко входу
      </Link>
    </form>
  );
}

export function ResetForm({ token, minLength }: { token: string; minLength: number }) {
  const [state, action, pending] = useActionState(setPasswordByToken, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <label className="block">
        <span className="text-sm font-medium text-stone-700">Новый пароль</span>
        <input name="password" type="password" required autoFocus minLength={minLength} autoComplete="new-password" className={inputCls} />
        <span className="mt-1 block text-xs text-stone-500">Не короче {minLength} символов</span>
      </label>
      <label className="block">
        <span className="text-sm font-medium text-stone-700">Ещё раз</span>
        <input name="password2" type="password" required minLength={minLength} autoComplete="new-password" className={inputCls} />
      </label>
      {state && !state.ok && (
        <p className="text-sm text-red-600" role="alert">
          {state.message}
        </p>
      )}
      <button disabled={pending} className={btnCls}>
        {pending && <LoaderCircle className="size-4 animate-spin" />} Сохранить пароль
      </button>
    </form>
  );
}
