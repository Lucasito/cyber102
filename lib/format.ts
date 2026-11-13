// Форматирование для карточек — общее для серверных и клиентских компонентов.

export const TZ = "Asia/Yekaterinburg";

/** Событие в виде, пригодном для передачи в клиентский компонент и JSON. */
export type CardEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  status: string;
  priceMin: number | null;
  priceMax: number | null;
  ageLimit: number | null;
  imageUrl: string | null;
  venue: { name: string; city: string } | null;
  category: { slug: string; name: string } | null;
  /** Расстояние от пользователя, км («Рядом со мной»). */
  distanceKm?: number | null;
};

type EventLike = Omit<CardEvent, "startsAt" | "endsAt" | "venue" | "category"> & {
  startsAt: Date | string;
  endsAt: Date | string | null;
  venue: { name: string; city: string } | null;
  category: { slug: string; name: string } | null;
};

export function toCard(e: EventLike): CardEvent {
  return {
    id: e.id,
    title: e.title,
    startsAt: new Date(e.startsAt).toISOString(),
    endsAt: e.endsAt ? new Date(e.endsAt).toISOString() : null,
    status: e.status,
    priceMin: e.priceMin,
    priceMax: e.priceMax,
    ageLimit: e.ageLimit,
    imageUrl: e.imageUrl,
    venue: e.venue ? { name: e.venue.name, city: e.venue.city } : null,
    category: e.category ? { slug: e.category.slug, name: e.category.name } : null,
    distanceKm: e.distanceKm ?? null,
  };
}

export function formatDistance(km: number) {
  return km < 1 ? `${Math.round(km * 1000 / 50) * 50} м` : `${km.toLocaleString("ru-RU", { maximumFractionDigits: km < 10 ? 1 : 0 })} км`;
}

export function formatPrice(e: { priceMin: number | null; priceMax: number | null }) {
  if (e.priceMin === 0 && !e.priceMax) return "Бесплатно";
  if (e.priceMin == null) return "Цена уточняется";
  const n = (v: number) => v.toLocaleString("ru-RU");
  return e.priceMax && e.priceMax !== e.priceMin ? `${n(e.priceMin)}–${n(e.priceMax)} ₽` : `от ${n(e.priceMin)} ₽`;
}

export const STATUS_LABELS: Record<string, string> = {
  RESCHEDULED: "Перенесено",
  CANCELLED: "Отменено",
  SOLD_OUT: "Билетов нет",
  PAST: "Прошло",
};

export function dayParts(iso: string) {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString("ru-RU", { timeZone: TZ, day: "numeric" }),
    month: d.toLocaleDateString("ru-RU", { timeZone: TZ, month: "short" }).replace(".", ""),
    weekday: d.toLocaleDateString("ru-RU", { timeZone: TZ, weekday: "short" }),
    time: d.toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }),
  };
}

export function formatDateLong(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** Оформление категории: подложка под иллюстрацией и цвет акцента. */
export const CATEGORY_STYLE: Record<string, string> = {
  theatre: "bg-rose-100 text-rose-400",
  concert: "bg-violet-100 text-violet-400",
  exhibition: "bg-amber-100 text-amber-500",
  museum: "bg-stone-200 text-stone-500",
  kids: "bg-sky-100 text-sky-400",
  cinema: "bg-slate-200 text-slate-500",
  festival: "bg-lime-100 text-lime-600",
  lecture: "bg-indigo-100 text-indigo-400",
  excursion: "bg-teal-100 text-teal-500",
};
export const DEFAULT_STYLE = "bg-emerald-100 text-emerald-500";

/** Только известные категории могут задавать имя файла иллюстрации. */
export function illustrationFor(slug?: string | null): string {
  return `/illustrations/${slug && Object.hasOwn(CATEGORY_STYLE, slug) ? slug : "default"}.svg`;
}
