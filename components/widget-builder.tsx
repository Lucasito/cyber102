"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

// Конструктор виджета: настройки → живой предпросмотр и готовый код для вставки на сайт.

type Opt = { value: string; label: string };
type State = {
  city: string;
  category: string;
  q: string;
  period: string;
  age: string;
  priceMax: string;
  free: boolean;
  pushkin: boolean;
  sort: string;
  limit: string;
  layout: string;
  title: string;
  accent: string;
  link: boolean;
  height: string;
  cols: string;
  img: boolean;
  theme: string;
  bg: string;
  bgColor: string;
  radius: string;
  font: string;
};

const INITIAL: State = {
  city: "",
  category: "",
  q: "",
  period: "",
  age: "",
  priceMax: "",
  free: false,
  pushkin: false,
  sort: "date",
  limit: "6",
  layout: "grid",
  title: "",
  accent: "#0b7a55",
  link: true,
  height: "auto",
  cols: "",
  img: true,
  theme: "light",
  bg: "transparent",
  bgColor: "#ffffff",
  radius: "16",
  font: "",
};
const DEFAULT_ACCENT = INITIAL.accent;

const PERIODS: Opt[] = [
  { value: "", label: "Все ближайшие" },
  { value: "today", label: "Сегодня" },
  { value: "tomorrow", label: "Завтра" },
  { value: "weekend", label: "Ближайшие выходные" },
  { value: "week", label: "7 дней" },
  { value: "month", label: "30 дней" },
];
const SORTS: Opt[] = [
  { value: "date", label: "По дате" },
  { value: "price_asc", label: "Сначала дешевле" },
  { value: "price_desc", label: "Сначала дороже" },
  { value: "new", label: "Недавно добавленные" },
];
const AGES: Opt[] = [
  { value: "", label: "Любой" },
  { value: "0", label: "0+ (малыши)" },
  { value: "6", label: "6+" },
  { value: "12", label: "12+" },
  { value: "16", label: "16+" },
];

/** Параметры виджета в порядке атрибутов кода; пустые и значения по умолчанию не пишем. */
function widgetParams(s: State): [string, string][] {
  const p: [string, string][] = [];
  const add = (k: string, v: string) => v && p.push([k, v]);
  add("city", s.city);
  add("category", s.category);
  add("q", s.q.trim());
  add("period", s.period);
  add("age", s.age);
  add("priceMax", s.priceMax);
  if (s.free) add("free", "1");
  if (s.pushkin) add("pushkin", "1");
  if (s.sort !== "date") add("sort", s.sort);
  add("limit", s.limit);
  if (s.layout !== "grid") add("layout", s.layout);
  add("title", s.title.trim());
  if (s.accent.toLowerCase() !== DEFAULT_ACCENT) add("accent", s.accent.replace("#", ""));
  if (!s.link) add("link", "0");
  if (s.layout === "grid") add("cols", s.cols);
  if (!s.img) add("img", "0");
  if (s.theme === "dark") add("theme", "dark");
  if (s.bg === "white") add("bg", "white");
  if (s.bg === "custom") add("bg", s.bgColor.replace("#", ""));
  if (s.radius !== "16") add("radius", s.radius);
  add("font", s.font);
  return p;
}

const attr = (k: string) => "data-" + k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Фон страницы в предпросмотре — как будто виджет стоит на вашем сайте (в код не попадает). */
const HOSTS: Opt[] = [
  { value: "#ffffff", label: "Белый" },
  { value: "#f3f1ec", label: "Светлый бежевый" },
  { value: "#e8eef7", label: "Светлый голубой" },
  { value: "#1c1917", label: "Тёмный" },
];

const inputCls = "w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-black/10 outline-none focus:ring-2 focus:ring-[var(--brand)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}
      className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium ring-1 ring-black/10 hover:ring-black/30"
    >
      {done ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      {done ? "Скопировано" : "Копировать"}
    </button>
  );
}

export function WidgetBuilder({ base, cities, categories }: { base: string; cities: string[]; categories: Opt[] }) {
  const [s, setS] = useState<State>(INITIAL);
  const [host, setHost] = useState(HOSTS[0].value);
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((old) => ({ ...old, [k]: v }));
  const params = useMemo(() => widgetParams(s), [s]);

  const scriptCode = useMemo(() => {
    const list = params.map(([k, v]) => `${attr(k)}="${esc(v)}"`);
    if (s.height !== "auto") list.push(`data-height="${parseInt(s.height, 10) || 480}"`);
    // Атрибуты — по одному в строке, чтобы код читался и не уходил за край
    const attrs = list.map((a) => `\n     ${a}`).join("");
    return `<div data-afisha-widget${attrs}></div>\n<script src="${base}/widget.js" async></script>`;
  }, [params, s.height, base]);
  const query = new URLSearchParams(params).toString();
  const iframeCode = `<iframe src="${base}/widget${query ? `?${esc(query)}` : ""}" title="Афиша культуры Башкортостана" loading="lazy" style="width:100%;border:0;height:${s.height === "auto" ? 600 : parseInt(s.height, 10) || 480}px"></iframe>`;

  // Предпросмотр: обновляем с небольшой задержкой, чтобы не перезагружать фрейм на каждую букву
  const [previewSrc, setPreviewSrc] = useState(`/widget?wid=preview`);
  useEffect(() => {
    const t = setTimeout(() => setPreviewSrc(`/widget?${new URLSearchParams([...params, ["wid", "preview"]]).toString()}`), 350);
    return () => clearTimeout(t);
  }, [params]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [autoHeight, setAutoHeight] = useState(480);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === "afisha-widget-height" && e.data.wid === "preview") setAutoHeight(Math.ceil(e.data.height));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const previewHeight = s.height === "auto" ? autoHeight : parseInt(s.height, 10) || 480;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <form className="space-y-4 rounded-3xl bg-stone-100 p-5" onSubmit={(e) => e.preventDefault()}>
        <p className="text-sm font-semibold">Что показывать</p>
        <Field label="Город">
          <select className={inputCls} value={s.city} onChange={(e) => set("city", e.target.value)}>
            <option value="">Все города</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Категория">
          <select className={inputCls} value={s.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">Все</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Слова в названии или описании">
          <input className={inputCls} value={s.q} onChange={(e) => set("q", e.target.value)} placeholder="например, джаз" maxLength={200} />
        </Field>
        <Field label="Период">
          <select className={inputCls} value={s.period} onChange={(e) => set("period", e.target.value)}>
            {PERIODS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Возраст зрителя">
            <select className={inputCls} value={s.age} onChange={(e) => set("age", e.target.value)}>
              {AGES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Цена до, ₽">
            <input className={inputCls} type="number" min={0} step={100} value={s.priceMax} onChange={(e) => set("priceMax", e.target.value)} placeholder="любая" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.free} onChange={(e) => set("free", e.target.checked)} /> Только бесплатные
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.pushkin} onChange={(e) => set("pushkin", e.target.checked)} /> По Пушкинской карте
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Сортировка">
            <select className={inputCls} value={s.sort} onChange={(e) => set("sort", e.target.value)}>
              {SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Событий">
            <input className={inputCls} type="number" min={1} max={30} value={s.limit} onChange={(e) => set("limit", e.target.value)} />
          </Field>
        </div>

        <p className="pt-2 text-sm font-semibold">Как выглядит</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Вид">
            <select className={inputCls} value={s.layout} onChange={(e) => set("layout", e.target.value)}>
              <option value="grid">Плитки</option>
              <option value="list">Список</option>
            </select>
          </Field>
          <Field label="Цвет">
            <input className="h-9 w-full cursor-pointer rounded-xl bg-white ring-1 ring-black/10" type="color" value={s.accent} onChange={(e) => set("accent", e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Колонок плиток">
            <select className={inputCls} value={s.cols} disabled={s.layout !== "grid"} onChange={(e) => set("cols", e.target.value)}>
              <option value="">По ширине</option>
              <option value="1">1</option>
              <option value="2">До 2</option>
              <option value="3">До 3</option>
              <option value="4">До 4</option>
            </select>
          </Field>
          <Field label="Тема карточек">
            <select className={inputCls} value={s.theme} onChange={(e) => set("theme", e.target.value)}>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </Field>
          <Field label="Фон виджета">
            <select className={inputCls} value={s.bg} onChange={(e) => set("bg", e.target.value)}>
              <option value="transparent">Прозрачный</option>
              <option value="white">Белый</option>
              <option value="custom">Свой цвет</option>
            </select>
          </Field>
          <Field label="Шрифт">
            <select className={inputCls} value={s.font} onChange={(e) => set("font", e.target.value)}>
              <option value="">Inter (как на афише)</option>
              <option value="system">Системный</option>
              <option value="serif">С засечками</option>
            </select>
          </Field>
        </div>
        {s.bg === "custom" && (
          <Field label="Цвет фона">
            <input className="h-9 w-full cursor-pointer rounded-xl bg-white ring-1 ring-black/10" type="color" value={s.bgColor} onChange={(e) => set("bgColor", e.target.value)} />
          </Field>
        )}
        <Field label={`Скругление карточек: ${s.radius} px`}>
          <input className="w-full accent-[var(--brand)]" type="range" min={0} max={24} step={2} value={s.radius} onChange={(e) => set("radius", e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.img} onChange={(e) => set("img", e.target.checked)} /> Картинки событий
        </label>
        <Field label="Заголовок над событиями">
          <input className={inputCls} value={s.title} onChange={(e) => set("title", e.target.value)} placeholder="без заголовка" maxLength={120} />
        </Field>
        <Field label="Высота">
          <select className={inputCls} value={s.height === "auto" ? "auto" : "fixed"} onChange={(e) => set("height", e.target.value === "auto" ? "auto" : "600")}>
            <option value="auto">По содержимому</option>
            <option value="fixed">Фиксированная, с прокруткой</option>
          </select>
        </Field>
        {s.height !== "auto" && (
          <Field label="Высота, px">
            <input className={inputCls} type="number" min={200} max={2000} step={20} value={s.height} onChange={(e) => set("height", e.target.value)} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.link} onChange={(e) => set("link", e.target.checked)} /> Ссылка «Вся афиша» внизу
        </label>
        <button type="button" onClick={() => setS(INITIAL)} className="text-sm text-stone-500 hover:text-stone-900">
          Сбросить настройки
        </button>
      </form>

      <div className="min-w-0 space-y-6">
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Код для сайта</h2>
            <CopyButton text={scriptCode} />
          </div>
          <pre className="overflow-x-auto rounded-2xl bg-stone-900 p-4 text-sm leading-relaxed text-stone-100">{scriptCode}</pre>
          <details className="mt-2 text-sm text-stone-600">
            <summary className="cursor-pointer">Если сайт не разрешает скрипты — код iframe</summary>
            <div className="mt-2 flex justify-end">
              <CopyButton text={iframeCode} />
            </div>
            <pre className="mt-2 overflow-x-auto rounded-2xl bg-stone-900 p-4 text-sm leading-relaxed text-stone-100">{iframeCode}</pre>
          </details>
        </section>
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Предпросмотр</h2>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2 text-stone-600">
                Фон вашего сайта
                <select className="rounded-lg bg-white px-2 py-1 ring-1 ring-black/10" value={host} onChange={(e) => setHost(e.target.value)}>
                  {HOSTS.map((h) => (
                    <option key={h.value} value={h.value}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </label>
              <a href={`/widget-demo?${query}`} target="_blank" rel="noopener" className="font-medium text-[var(--brand)] hover:underline">
                На примере сайта ↗
              </a>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl p-3 ring-1 ring-black/10 transition-colors" style={{ background: host }}>
            <iframe ref={frame} src={previewSrc} title="Предпросмотр виджета" className="block w-full border-0" style={{ height: previewHeight, colorScheme: "normal" }} />
          </div>
        </section>
      </div>
    </div>
  );
}
