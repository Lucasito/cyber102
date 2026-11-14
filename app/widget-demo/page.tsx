import type { Metadata } from "next";
import Script from "next/script";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Пример сайта с виджетом", robots: { index: false, follow: false } };

// Тестовая страница «чужого сайта» (выдуманный дом культуры): как виджет выглядит среди обычного текста.
// Основной виджет — с параметрами из адреса (их передаёт конструктор /docs/widget), в боковой колонке — компактный список.

const HOSTS = {
  light: { label: "Светлый", page: "#ffffff", text: "#1f2937", muted: "#6b7280", panel: "#f3f4f6", line: "#e5e7eb", accent: "#7c3aed" },
  beige: { label: "Бежевый", page: "#f6f1e7", text: "#3b2f22", muted: "#7a6a58", panel: "#ece3d3", line: "#dccfb9", accent: "#a0522d" },
  dark: { label: "Тёмный", page: "#111827", text: "#e5e7eb", muted: "#9ca3af", panel: "#1f2937", line: "#374151", accent: "#f59e0b" },
} as const;

const attr = (k: string) => "data-" + k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

export default async function WidgetDemo({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { host: hostKey, ...params } = await searchParams;
  const h = HOSTS[(hostKey as keyof typeof HOSTS) in HOSTS ? (hostKey as keyof typeof HOSTS) : "light"];
  // Тёмный сайт без явной темы — тёмные карточки, иначе подписи виджета на прозрачном фоне не читаются
  const main = Object.fromEntries(Object.entries({ limit: "6", ...(hostKey === "dark" && !params.theme ? { theme: "dark" } : {}), ...params }).map(([k, v]) => [attr(k), String(v).slice(0, 200)]));
  const side = { "data-layout": "list", "data-img": "0", "data-limit": "4", "data-link": "0", "data-period": "week", ...(hostKey === "dark" ? { "data-theme": "dark" } : {}) };
  const query = (host: string) => new URLSearchParams({ ...params, host }).toString();

  return (
    <div style={{ background: h.page, color: h.text, minHeight: "100vh", fontFamily: 'Georgia, "Times New Roman", serif' }}>
      <style>{`body{background:${h.page}}`}</style>
      {/* Служебная полоса: это тест, не настоящий сайт */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-stone-900 px-4 py-2 font-sans text-xs text-stone-200">
        <span>Тестовая страница: так виджет афиши выглядит на чужом сайте. Сайт выдуман.</span>
        <span className="flex gap-2">
          Фон сайта:
          {Object.entries(HOSTS).map(([k, v]) => (
            <a key={k} href={`?${query(k)}`} className={`underline-offset-2 hover:underline ${(hostKey ?? "light") === k ? "font-semibold text-white" : ""}`}>
              {v.label}
            </a>
          ))}
        </span>
        <a href="/docs/widget" className="underline underline-offset-2">
          ← В конструктор
        </a>
      </div>

      <header style={{ borderBottom: `1px solid ${h.line}` }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5">
          <div>
            <p className="text-2xl font-bold" style={{ color: h.accent }}>
              Дом культуры «Пример»
            </p>
            <p className="text-sm" style={{ color: h.muted }}>
              Кружки, концерты и встречи для всей семьи
            </p>
          </div>
          <nav className="flex gap-5 font-sans text-sm" style={{ color: h.muted }}>
            <span>Главная</span>
            <span style={{ color: h.text, fontWeight: 600 }}>Афиша</span>
            <span>Кружки</span>
            <span>Контакты</span>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0">
          <h1 className="text-3xl font-bold">Куда сходить в Башкортостане</h1>
          <p className="mt-4 max-w-2xl leading-relaxed" style={{ color: h.muted }}>
            Мы собрали для вас ближайшие спектакли, концерты и выставки республики. Подборка обновляется сама: когда в афише появляется новое событие, оно
            сразу видно здесь. Нажмите на карточку, чтобы узнать подробности и купить билет.
          </p>

          <div className="mt-6">
            <div data-afisha-widget {...main} />
          </div>

          <h2 className="mt-12 text-2xl font-bold">О нашем доме культуры</h2>
          <p className="mt-3 leading-relaxed" style={{ color: h.muted }}>
            У нас занимаются хор, театральная студия и кружок народного танца. По выходным проходят семейные концерты и мастер-классы. Вход на большинство
            мероприятий свободный — следите за расписанием и приходите всей семьёй.
          </p>
          <p className="mt-3 leading-relaxed" style={{ color: h.muted }}>
            Этот абзац нужен, чтобы было видно, как виджет стыкуется с обычным текстом страницы: отступы, ширина колонки, шрифт и цвета.
          </p>
        </main>

        <aside className="space-y-6">
          <div className="rounded-xl p-4" style={{ background: h.panel }}>
            <p className="font-bold">Режим работы</p>
            <p className="mt-1 text-sm" style={{ color: h.muted }}>
              Вт–вс, 10:00–20:00
              <br />
              Понедельник — выходной
            </p>
          </div>
          <div className="rounded-xl p-4" style={{ background: h.panel }}>
            <p className="mb-2 font-bold">На этой неделе</p>
            <div data-afisha-widget {...side} />
          </div>
        </aside>
      </div>

      <footer className="px-4 py-8 text-center text-sm" style={{ borderTop: `1px solid ${h.line}`, color: h.muted }}>
        © Дом культуры «Пример» — выдуманный сайт для демонстрации виджета
      </footer>
      {/* После гидратации: страница сама на React, и виджет не должен менять разметку раньше неё */}
      <Script src="/widget.js" strategy="afterInteractive" />
    </div>
  );
}
