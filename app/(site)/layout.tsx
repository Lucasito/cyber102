import { headers } from "next/headers";
import Link from "next/link";
import { MessengerIcon } from "@/components/messenger-icon";
import { DEMO_SOURCE } from "@/lib/demo-data";
import { tr, type Lang } from "@/lib/i18n";
import { botLinks } from "@/lib/server/bot-links";
import { db } from "@/lib/server/db";
import { getLang } from "@/lib/server/lang";
import { getSettings } from "@/lib/server/settings";

/** Переключатель языка: ссылка на /lang/<код>?back=<текущая страница>. */
async function LangSwitch({ lang }: { lang: Lang }) {
  const h = await headers();
  const back = h.get("x-afisha-path") ?? "/";
  return (
    <div className="flex shrink-0 rounded-full bg-black/5 p-0.5 text-xs font-medium" role="group" aria-label="Язык / Тел">
      {(
        [
          ["ru", "Рус"],
          ["ba", "Баш"],
        ] as const
      ).map(([code, label]) => (
        <a
          key={code}
          href={`/lang/${code}?back=${encodeURIComponent(back)}`}
          hrefLang={code}
          aria-current={lang === code ? "true" : undefined}
          className={`rounded-full px-2.5 py-1 ${lang === code ? "bg-white shadow-sm" : "text-stone-500 hover:text-stone-900"}`}
        >
          {label}
        </a>
      ))}
    </div>
  );
}

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [site, bots, lang] = await Promise.all([getSettings("site"), botLinks(), getLang()]);
  const hasDemo = site.testBanner && (await db.event.count({ where: { sources: { some: { source: DEMO_SOURCE } } }, take: 1 })) > 0;
  return (
    <div className="flex min-h-dvh flex-col" lang={lang === "ba" ? "ba" : "ru"}>
      {hasDemo && (
        <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          <b>{tr(lang, "testBanner")}</b> {tr(lang, "testBannerText")}
        </div>
      )}
      {site.notice && <div className="bg-stone-900 px-4 py-2 text-center text-sm text-white">{site.notice}</div>}
      <header className="sticky top-0 z-20 border-b border-black/5 bg-[#f7f6f3]/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG-логотип */}
            <img src="/brand/logo.svg" alt="" className="size-8 shrink-0 rounded-lg" />
            <span className="hidden truncate md:inline">{tr(lang, "siteName")}</span>
            <span className="truncate md:hidden">{tr(lang, "siteShort")}</span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 text-sm">
            {bots.length > 0 && (
              <nav className="flex items-center gap-1.5" aria-label="Боты">
                <span className="mr-1 hidden text-stone-500 lg:inline">{tr(lang, "botsLabel")}</span>
                {bots.map((b) => (
                  <a
                    key={b.platform}
                    href={b.url}
                    target="_blank"
                    rel="noopener"
                    aria-label={`${tr(lang, "botIn")} ${b.label}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 py-1.5 pr-3.5 pl-2.5 font-medium text-white hover:bg-stone-700 max-sm:px-2"
                  >
                    <MessengerIcon platform={b.platform} className="size-4" />
                    <span className="max-sm:sr-only">{b.label}</span>
                  </a>
                ))}
              </nav>
            )}
            <LangSwitch lang={lang} />
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-black/5">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-stone-500 sm:flex-row sm:items-center">
          <p>{tr(lang, "footerReal")}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 sm:ml-auto">
            {bots.map((b) => (
              <a key={b.platform} href={b.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 hover:text-stone-900">
                <MessengerIcon platform={b.platform} className="size-3.5" />
                {tr(lang, "botIn")} {b.label}
              </a>
            ))}
            <Link href="/docs" className="hover:text-stone-900">
              {tr(lang, "forDevs")}
            </Link>
            <Link href="/docs/widget" className="hover:text-stone-900">
              {tr(lang, "widgetBuilder")}
            </Link>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-6 text-xs">
          <Link href="/admin/login" rel="nofollow" className="text-stone-400 hover:text-stone-700">
            {tr(lang, "adminLogin")}
          </Link>
        </div>
      </footer>
    </div>
  );
}
