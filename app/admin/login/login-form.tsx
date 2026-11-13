"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState } from "react";
import { login } from "./actions";

const inputCls = "w-full rounded-xl bg-stone-100 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--brand)]";

export function LoginForm() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-stone-700">Логин</span>
        <input name="login" autoComplete="username" required autoFocus className={`mt-1 ${inputCls}`} />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-stone-700">Пароль</span>
        <input name="password" type="password" autoComplete="current-password" required className={`mt-1 ${inputCls}`} />
      </label>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <button
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {pending && <LoaderCircle className="size-4 animate-spin" />} Войти
      </button>
    </form>
  );
}
