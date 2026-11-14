"use client";

import { ArrowUp, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EventCard } from "@/components/event-card";
import { groupSessions, toCard, type CardEvent } from "@/lib/format";
import { quickLabel, setBaOverrides, type DictKey, type Lang } from "@/lib/i18n";

// Умный поиск в виде чата: до первого вопроса — строка ввода с примерами,
// дальше — окно диалога с пузырями, подборками под ответами и быстрыми ответами.

type T = Record<DictKey, string>;
/** content — что видит пользователь; send — что уходит помощнику (быстрые ответы на башкирском отправляются по-русски). */
type Msg = { role: "user" | "assistant"; content: string; send?: string; events?: CardEvent[]; suggestions?: string[]; error?: boolean; degraded?: boolean; ageNote?: boolean; why?: Record<string, string[]>; askLocation?: boolean };

/** Этапы ожидания: запросы к ИИ идут по очереди, поэтому при наплыве ответ может занять до минуты. */
const STAGES: [number, DictKey][] = [
  [0, "stage0"],
  [3, "stage1"],
  [8, "stage2"],
  [20, "stage3"],
];

function Avatar() {
  // eslint-disable-next-line @next/next/no-img-element -- SVG-логотип
  return <img src="/brand/logo.svg" alt="" className="mt-0.5 size-8 shrink-0 rounded-full" />;
}

function Typing({ t }: { t: T }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, []);
  const stage = STAGES.findLast(([from]) => seconds >= from)![1];
  return (
    <div className="flex gap-2.5">
      <Avatar />
      <div className="rounded-2xl rounded-tl-md bg-white px-4 py-3 ring-1 ring-black/5">
        <div className="flex items-center gap-1" aria-hidden>
          {[0, 150, 300].map((d) => (
            <span key={d} className="size-1.5 animate-bounce rounded-full bg-stone-400" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
        <p className="mt-1.5 text-sm text-stone-500" role="status">
          {t[stage]}
          {seconds >= 8 && (
            <span className="ml-1 tabular-nums text-stone-500">
              {seconds} {t.seconds}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function QuickReplies({ items, lang, onPick }: { items: string[]; lang: Lang; onPick: (s: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="rounded-full bg-white px-3.5 py-1.5 text-sm text-stone-700 ring-1 ring-black/10 transition hover:text-[var(--brand)] hover:ring-[var(--brand)]"
        >
          {quickLabel(s, lang)}
        </button>
      ))}
    </div>
  );
}

/** Подборка в чате: компактные строки, сначала 4, остальное — по кнопке. */
function ChatEvents({ events, lang, t, first, ageNote, why }: { events: CardEvent[]; lang: Lang; t: T; first: number; ageNote?: boolean; why?: Record<string, string[]> }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, first);
  return (
    <div className="space-y-2 sm:ml-10">
      <div className="grid gap-2 lg:grid-cols-2">
        {shown.map((e) => (
          <div key={e.id}>
            <EventCard event={e} row lang={lang} ageNote={ageNote} />
            {/* Почему в подборке: условия запроса, ✓ — выполнено, ✗ — пришлось снять (формирует сервер) */}
            {!!why?.[e.id]?.length && <p className="mt-1 px-1 text-xs text-stone-500">{why[e.id].join(" · ")}</p>}
          </div>
        ))}
      </div>
      {events.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="text-sm font-medium text-[var(--brand)] hover:underline">
          {t.showMore} ({events.length - shown.length})
        </button>
      )}
    </div>
  );
}

export function AskBox({
  examples,
  lang,
  t,
  chatEvents = 4,
  ba,
  initialQuestion,
}: {
  examples: string[];
  lang: Lang;
  t: T;
  chatEvents?: number;
  ba?: Record<string, string>;
  /** Вопрос из виджета на другом сайте (/?ask=…) — отправляется сразу, параметр убирается из адреса */
  initialQuestion?: string;
}) {
  // Башкирский перевод из админки — в клиентский модуль (подписи карточек и быстрых ответов)
  if (ba) setBaOverrides(ba);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const started = messages.length > 0;

  // Новое сообщение — прокручиваем к нему (только внутри видимой области, без прыжков страницы)
  useEffect(() => {
    if (started) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, loading, started]);

  const askedInitial = useRef(false);
  useEffect(() => {
    if (!initialQuestion?.trim() || askedInitial.current) return;
    askedInitial.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("ask");
    window.history.replaceState(null, "", url);
    void ask(initialQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз при открытии страницы
  }, [initialQuestion]);

  /** text — что отправить помощнику; shown — как показать в чате (по умолчанию то же). */
  async function ask(text: string, shown?: string) {
    const q = text.trim();
    if (!q || loading) return;
    if (/^новый поиск$/i.test(q)) return reset();
    const next: Msg[] = [...messages, { role: "user", content: shown ?? q, send: q }];
    setInput("");
    await request(next);
  }

  /**
   * Запрос к помощнику по истории next. location — для «рядом со мной»: координаты с согласия человека (браузер
   * спрашивает разрешение) или "denied"; уходят только в этот запрос и нигде на сайте не сохраняются.
   */
  async function request(next: Msg[], location?: { lat: number; lon: number } | "denied") {
    setMessages(next);
    setLoading(true);
    try {
      const history = next
        .filter((m) => !m.error)
        .map(({ role, content, send }) => ({ role, content: send ?? content }))
        .slice(-10);
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Afisha-Client": "site" },
        body: JSON.stringify({ messages: history, lang, ...(location ? { location } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? t.aiFailed);
      setMessages([...next, { role: "assistant", content: data.text, events: groupSessions((data.events ?? []).map(toCard)), suggestions: data.suggestions ?? [], degraded: !!data.degraded, ageNote: data.filter?.age != null, why: data.why, askLocation: !!data.askLocation }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: e instanceof Error ? e.message : t.netError, error: true }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  }

  /** «Рядом со мной»: повторяем тот же запрос (без вопроса о местоположении) — с координатами или без них. */
  function answerLocation(share: boolean) {
    const base = messages.at(-1)?.askLocation ? messages.slice(0, -1) : messages;
    if (!share || !navigator.geolocation) return void request(base, "denied");
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (p) => void request(base, { lat: p.coords.latitude, lon: p.coords.longitude }),
      () => void request(base, "denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  function reset() {
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  }

  const lastAssistant = messages.findLastIndex((m) => m.role === "assistant");

  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void ask(input);
      }}
      className={`relative bg-white focus-within:ring-2 focus-within:ring-[var(--brand)] ${started ? "rounded-2xl ring-1 ring-black/10" : "rounded-3xl p-2 shadow-xl shadow-black/5 ring-1 ring-black/5"}`}
    >
      {!started && <Sparkles className="absolute top-5 left-5 size-5 text-[var(--brand)]" aria-hidden />}
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void ask(input);
          }
        }}
        rows={1}
        maxLength={500}
        placeholder={started ? t.chatPlaceholder : t.askPlaceholder}
        aria-label={t.chatPlaceholder}
        className={`block max-h-40 w-full resize-none bg-transparent text-base outline-none placeholder:text-stone-500 focus-visible:outline-none [field-sizing:content] ${started ? "min-h-11 py-2.5 pr-12 pl-4" : "min-h-12 py-3 pr-14 pl-11"}`}
      />
      <button
        type="submit"
        disabled={loading || !input.trim()}
        aria-label={t.send}
        className={`absolute grid place-items-center rounded-full bg-[var(--brand)] text-white transition hover:brightness-110 disabled:bg-stone-200 disabled:text-stone-400 ${started ? "right-1.5 bottom-1.5 size-8" : "right-3 bottom-3 size-10"}`}
      >
        {loading ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className={started ? "size-4" : "size-5"} />}
      </button>
    </form>
  );

  if (!started) {
    return (
      <div>
        {form}
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto sm:flex-wrap sm:justify-center">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => void ask(ex)}
              className="shrink-0 rounded-full bg-white/70 px-3.5 py-1.5 text-sm text-stone-600 ring-1 ring-black/5 hover:bg-white hover:text-stone-900"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl bg-stone-100/80 shadow-xl shadow-black/5 ring-1 ring-black/5" aria-label={t.assistant}>
      <header className="flex items-center gap-2.5 border-b border-black/5 bg-white/70 px-4 py-2.5">
        <Avatar />
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold">{t.assistant}</p>
          <p className="text-xs text-stone-500">{loading ? t.typing : t.assistantNote}</p>
        </div>
        <button type="button" onClick={reset} className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-stone-500 hover:bg-black/5 hover:text-stone-900">
          <RotateCcw className="size-3.5" /> <span className="max-sm:hidden">{t.newChat}</span>
        </button>
      </header>

      <div className="space-y-4 px-3 py-4 sm:px-4" aria-live="polite">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-tr-md bg-stone-900 px-4 py-2.5 whitespace-pre-line text-white">{m.content}</p>
            </div>
          ) : (
            <div key={i} className="space-y-3">
              <div className="flex gap-2.5">
                <Avatar />
                <p
                  className={`max-w-[85%] rounded-2xl rounded-tl-md px-4 py-2.5 leading-relaxed whitespace-pre-line ring-1 ${m.error ? "bg-red-50 text-red-700 ring-red-200" : "bg-white text-stone-800 ring-black/5"}`}
                >
                  {m.content}
                </p>
              </div>
              {m.degraded && (
                <p className="text-xs text-amber-800 sm:ml-10" role="note">
                  {t.degradedNote}
                </p>
              )}
              {!!m.events?.length && <ChatEvents events={m.events} lang={lang} t={t} first={chatEvents} ageNote={m.ageNote} why={m.why} />}
              {i === lastAssistant && !loading && m.askLocation && (
                <div className="flex flex-wrap gap-2 sm:ml-10">
                  <button type="button" onClick={() => answerLocation(true)} className="rounded-full bg-[var(--brand)] px-4 py-1.5 text-sm font-medium text-white hover:brightness-110">
                    {t.locateMe}
                  </button>
                  <button type="button" onClick={() => answerLocation(false)} className="rounded-full bg-white px-4 py-1.5 text-sm ring-1 ring-black/10 hover:ring-black/30">
                    {t.noLocation}
                  </button>
                </div>
              )}
              {i === lastAssistant && !loading && !m.askLocation && (
                <div className="sm:ml-10">
                  <QuickReplies
                    lang={lang}
                    items={m.error ? ["Новый поиск"] : (m.suggestions ?? []).filter((s) => !/^новый поиск$/i.test(s))}
                    onPick={(s) => void ask(s, quickLabel(s, lang))}
                  />
                </div>
              )}
            </div>
          ),
        )}
        {loading && <Typing t={t} />}
        <div ref={endRef} />
      </div>

      <div className="border-t border-black/5 bg-white/70 p-2.5">{form}</div>
    </section>
  );
}
