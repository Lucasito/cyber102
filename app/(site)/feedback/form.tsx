"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, useState } from "react";
import { sendFeedback } from "./actions";

const inputCls = "mt-1 w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-black/10 outline-none focus:ring-2 focus:ring-[var(--brand)]";

export function FeedbackForm({ eventId, eventTitle, kind }: { eventId?: string; eventTitle?: string; kind?: string }) {
  const [state, action, pending] = useActionState(sendFeedback, null);
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
      {eventId && <input type="hidden" name="eventId" value={eventId} />}
      {/* Ловушка для ботов: людям не видна */}
      <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
        <label>
          Сайт <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-stone-700">О чём сообщение</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            ["organizer", "Заявка организатора — добавить событие"],
            ["correction", "Уточнение или ошибка в событии"],
            ["question", "Вопрос"],
          ].map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-black/10 has-[:checked]:ring-2 has-[:checked]:ring-[var(--brand)]">
              <input type="radio" name="kind" value={value} defaultChecked={value === (kind ?? (eventId ? "correction" : "organizer"))} className="accent-[var(--brand)]" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {eventTitle && <p className="text-sm text-stone-600">Событие: «{eventTitle}»</p>}
      <label className="block">
        <span className="text-sm font-medium text-stone-700">Сообщение</span>
        <textarea
          name="message"
          required
          minLength={10}
          maxLength={3000}
          rows={6}
          className={inputCls}
          placeholder="Для заявки: название, дата и время, площадка, город, цена, возраст и ссылка на источник или билеты."
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Как к вам обращаться</span>
          <input name="name" maxLength={100} autoComplete="name" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Почта или телефон для ответа</span>
          <input name="contact" maxLength={150} autoComplete="email" className={inputCls} />
          <span className="mt-1 block text-xs text-stone-500">Необязательно. Используем только для ответа на это обращение.</span>
        </label>
      </div>
      {state && !state.ok && (
        <p className="text-sm text-red-600" role="alert">
          {state.message}
        </p>
      )}
      <button disabled={pending} className="inline-flex items-center gap-2 rounded-full bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
        {pending && <LoaderCircle className="size-4 animate-spin" />} Отправить
      </button>
    </form>
  );
}
