import { Accessibility, ArrowLeft, CalendarPlus, Clock, CreditCard, MapPin, Ticket, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { EventGrid } from "@/components/event-card";
import { ShareButton } from "@/components/share-button";
import { FavoriteButton } from "@/components/favorite-button";
import { EventWatchLinks } from "@/components/event-watch-links";
import { botLinks } from "@/lib/server/bot-links";
import { CATEGORY_STYLE, DEFAULT_STYLE, formatDateLong, formatPrice, illustrationFor, toCard, TZ } from "@/lib/format";
import { db } from "@/lib/server/db";
import { searchEvents } from "@/lib/server/events";
import { accessLabel, categoryName, formatDateLongL, formatPriceL, statusLabel, tr, type DictKey } from "@/lib/i18n";
import { getLang } from "@/lib/server/lang";
import { mapConfig } from "@/lib/server/settings";
import { VenueMap } from "@/components/venue-map";

export const dynamic = "force-dynamic";

// Черновик посетителям не показываем (как несуществующее); отменённое — показываем с пометкой
const getEvent = cache((id: string) => db.event.findFirst({ where: { id, publication: "PUBLISHED" }, include: { venue: true, category: true, sources: true } }));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const e = await getEvent((await params).id);
  if (!e) return {};
  return {
    title: e.title,
    description: `${formatDateLong(e.startsAt.toISOString())}${e.venue ? `, ${e.venue.name}, ${e.venue.city}` : ""}. ${formatPrice(e)}.`,
    // Картинка-превью — opengraph-image.tsx рядом
  };
}

const STATUS_SCHEMA: Record<string, string> = {
  SCHEDULED: "https://schema.org/EventScheduled",
  RESCHEDULED: "https://schema.org/EventRescheduled",
  CANCELLED: "https://schema.org/EventCancelled",
  SOLD_OUT: "https://schema.org/EventScheduled",
  PAST: "https://schema.org/EventScheduled",
};

/** Разметка schema.org Event — поисковики показывают события расширенным сниппетом. */
function eventJsonLd(e: NonNullable<Awaited<ReturnType<typeof getEvent>>>) {
  const url = `${process.env.PUBLIC_URL ?? ""}/events/${e.id}`;
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title,
    description: e.description ?? undefined,
    startDate: e.startsAt.toISOString(),
    endDate: e.endsAt?.toISOString(),
    eventStatus: STATUS_SCHEMA[e.status],
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url,
    image: e.imageUrl ?? undefined, // без фото поисковики возьмут картинку-превью из og:image
    typicalAgeRange: e.ageLimit != null ? `${e.ageLimit}-` : undefined,
    isAccessibleForFree: e.priceMin === 0,
    location: e.venue
      ? {
          "@type": "Place",
          name: e.venue.name,
          address: { "@type": "PostalAddress", addressLocality: e.venue.city, streetAddress: e.venue.address ?? undefined, addressRegion: "Республика Башкортостан", addressCountry: "RU" },
          geo: e.venue.lat != null && e.venue.lon != null && !e.venue.approx ? { "@type": "GeoCoordinates", latitude: e.venue.lat, longitude: e.venue.lon } : undefined,
        }
      : undefined,
    offers:
      e.priceMin != null
        ? {
            "@type": "Offer",
            price: e.priceMin,
            priceCurrency: "RUB",
            url: e.ticketUrl ?? url,
            availability: e.status === "SOLD_OUT" ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
          }
        : undefined,
  };
}

function Fact({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-stone-400" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const e = await getEvent((await params).id);
  if (!e) notFound();
  const lang = await getLang();
  const t = (k: DictKey, v?: Record<string, string | number>) => tr(lang, k, v);
  const status = statusLabel(e.status, lang);
  const end = e.endsAt?.toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const more = e.categoryId
    ? (await searchEvents({ category: e.category!.slug, limit: 4, offset: 0 })).items.filter((x) => x.id !== e.id).slice(0, 3)
    : [];
  // Другие показы того же события на той же площадке — в каталоге они сведены в одну карточку (groupSessions)
  const sessions = e.venueId
    ? await db.event.findMany({
        where: {
          id: { not: e.id },
          venueId: e.venueId,
          title: { equals: e.title, mode: "insensitive" },
          publication: "PUBLISHED",
          status: { notIn: ["PAST", "CANCELLED"] },
          startsAt: { gte: new Date() },
        },
        orderBy: { startsAt: "asc" },
        take: 20,
        select: { id: true, startsAt: true },
      })
    : [];

  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 pb-16">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-900">
        <ArrowLeft className="size-4" /> {t("allAfisha")}
      </Link>

      <div className="mt-4 grid gap-8 lg:grid-cols-[3fr_2fr]">
        <div className={`relative aspect-[16/10] overflow-hidden rounded-3xl ${CATEGORY_STYLE[e.category?.slug ?? ""] ?? DEFAULT_STYLE}`}>
          {e.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- внешние картинки источников
            <img src={e.imageUrl} alt={`Афиша: ${e.title}`} className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- локальная SVG-иллюстрация без растровой оптимизации
            <img src={illustrationFor(e.category?.slug)} alt="" className="h-full w-full object-cover" />
          )}
        </div>

        <div className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {e.category && <span className="font-medium text-[var(--brand)]">{categoryName(e.category.slug, e.category.name, lang)}</span>}
            {e.ageLimit != null && <span className="rounded border border-stone-300 px-1.5 text-xs">{e.ageLimit}+</span>}
            {status && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">{status}</span>}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{e.title}</h1>

          <div className="mt-6 space-y-4">
            <Fact icon={Clock}>
              <p className="first-letter:uppercase">{formatDateLongL(e.startsAt.toISOString(), lang)}</p>
              {end && <p className="text-sm text-stone-500">{t("untilTime", { time: end })}</p>}
              {sessions.length > 0 && (
                <div className="mt-2">
                  <p className="text-sm text-stone-500">{t("otherSessions")}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {sessions.map((s) => (
                      <Link key={s.id} href={`/events/${s.id}`} className="rounded-full bg-white px-3 py-1 text-sm ring-1 ring-black/10 hover:ring-black/30">
                        {s.startsAt.toLocaleString("ru-RU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </Fact>
            {e.venue && (
              <Fact icon={MapPin}>
                <p>{e.venue.name}</p>
                <p className="text-sm text-stone-500">
                  {e.venue.city}
                  {e.venue.address && `, ${e.venue.address}`}
                </p>
              </Fact>
            )}
            <Fact icon={Ticket}>
              <p>{formatPriceL(e, lang)}</p>
            </Fact>
            {e.ageLimit != null && (
              <Fact icon={Users}>
                <p>{e.ageLimit === 0 ? t("noAge") : t("ageFrom", { age: e.ageLimit })}</p>
              </Fact>
            )}
            {e.pushkinCard && (
              <Fact icon={CreditCard}>
                <p>{t("pushkinPay")}</p>
                <p className="text-sm text-stone-500">{t("pushkinWho")}</p>
              </Fact>
            )}
            {e.accessibility.length > 0 && (
              <Fact icon={Accessibility}>
                <p>{t("access")}</p>
                <p className="text-sm text-stone-500">{e.accessibility.map((a) => accessLabel(a, lang)).join(" · ")}</p>
              </Fact>
            )}
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {e.ticketUrl && e.status !== "CANCELLED" && e.status !== "PAST" && (
              <a href={e.ticketUrl} target="_blank" rel="noopener" className="rounded-full bg-[var(--brand)] px-6 py-3 font-medium text-white hover:brightness-110">
                {e.status === "SOLD_OUT" ? t("ticketsPage") : t("buy")}
              </a>
            )}
            <a href={`/events/${e.id}/ics`} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-medium ring-1 ring-black/10 hover:ring-black/30">
              <CalendarPlus className="size-4" /> {t("toCalendar")}
            </a>
            <ShareButton title={e.title} label={t("share")} copiedLabel={t("copied")} />
            <FavoriteButton eventId={e.id} lang={lang} />
          </div>
          {e.status !== "PAST" && <div className="mt-4"><EventWatchLinks eventId={e.id} bots={await botLinks()} lang={lang} /></div>}
        </div>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(eventJsonLd(e)).replace(/</g, "\\u003c") }} />

      <div className="mt-10 grid gap-8 lg:grid-cols-[3fr_2fr]">
        {e.description ? (
          <section>
            <h2 className="mb-3 text-lg font-semibold">{t("about")}</h2>
            <p className="leading-relaxed whitespace-pre-line text-stone-700">{e.description}</p>
          </section>
        ) : (
          <div />
        )}
        {e.venue?.approx && (
          <section>
            <h2 className="mb-2 text-lg font-semibold">{t("howToGet")}</h2>
            <p className="text-sm text-stone-600">{t("placeApprox")}</p>
          </section>
        )}
        {e.venue?.lat != null && e.venue.lon != null && !e.venue.approx && (
          <section>
            <h2 className="mb-3 text-lg font-semibold">{t("howToGet")}</h2>
            <VenueMap
              config={await mapConfig()}
              className="h-64"
              points={[{ lat: e.venue.lat, lon: e.venue.lon, title: e.venue.name, lines: [{ text: [e.venue.city, e.venue.address].filter(Boolean).join(", ") }] }]}
            />
            <a
              href={`https://yandex.ru/maps/?rtext=~${e.venue.lat},${e.venue.lon}&rtt=auto`}
              target="_blank"
              rel="noopener"
              className="mt-2 inline-block text-sm text-[var(--brand)] hover:underline"
            >
              {t("route")}
            </a>
          </section>
        )}
      </div>

      <p className="mt-8 text-sm text-stone-500">
        {t("source")}{" "}
        {e.sources.map((s, i) => (
          <span key={s.id}>
            {i > 0 && ", "}
            <a href={s.url} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-stone-900">
              {new URL(s.url).hostname}
            </a>
          </span>
        ))}
        {" · "}
        <Link href={`/feedback?event=${e.id}`} className="underline underline-offset-2 hover:text-stone-900">
          {t("reportError")}
        </Link>
      </p>

      {more.length > 0 && (
        <section className="mt-14">
          <h2 className="mb-4 text-xl font-semibold tracking-tight">{t("more")} {categoryName(e.category!.slug, e.category!.name, lang).toLowerCase()}</h2>
          <EventGrid events={more.map(toCard)} lang={lang} />
        </section>
      )}
    </main>
  );
}
