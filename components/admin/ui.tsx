"use client";

import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { useActionState, useTransition, useState } from "react";
import type { ActionState } from "@/app/admin/actions";

// Небольшой набор элементов форм админки.

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-xl bg-stone-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--brand)]";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={inputCls} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={inputCls} />;
}

export function Toggle({ name, defaultChecked, label }: { name: string; defaultChecked: boolean; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 select-none">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-stone-300 transition peer-checked:bg-[var(--brand)] after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

/** Поле секрета: значение не показываем, пусто — оставить как есть. */
export function SecretInput({ name, masked, fromEnv }: { name: string; masked: string; fromEnv?: boolean }) {
  return (
    <div className="space-y-1">
      <Input name={name} type="password" autoComplete="off" placeholder={masked ? `Задан: ${masked}` : fromEnv ? "Берётся из .env на сервере" : "Не задан"} />
      {masked && (
        <label className="flex items-center gap-2 text-xs text-stone-500">
          <input type="checkbox" name={`clear_${name}`} /> Очистить
        </label>
      )}
    </div>
  );
}

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p className={`flex items-start gap-1.5 text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`} role="status">
      {state.ok ? <Check className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
      <span className="break-words">{state.message}</span>
    </p>
  );
}

export function SettingsForm({
  action,
  children,
  extra,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-4">
      {children}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button disabled={pending} className="inline-flex items-center gap-2 rounded-full bg-stone-900 px-5 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
          {pending && <LoaderCircle className="size-4 animate-spin" />} Сохранить
        </button>
        {extra}
        <Result state={state} />
      </div>
    </form>
  );
}

/** Кнопка отдельного действия (проверка подключения, тестовые данные) с результатом рядом. */
export function ActionButton({ action, children, confirm }: { action: () => Promise<ActionState>; children: React.ReactNode; confirm?: string }) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setState(await action()));
        }}
        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium ring-1 ring-black/10 hover:ring-black/30 disabled:opacity-50"
      >
        {pending && <LoaderCircle className="size-4 animate-spin" />}
        {children}
      </button>
      <Result state={state} />
    </span>
  );
}
