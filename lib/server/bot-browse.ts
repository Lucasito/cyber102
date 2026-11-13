import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { datePresets, eventFilterSchema, filterOptions, localDay, searchEvents, TZ, type EventItem } from "./events";
import { getSettings } from "./settings";

// Поиск в ботах кнопками, без ИИ (ТЗ 6.2): главное меню, город, категория, дата, цена, «Показать ещё»,
// карточка события, подписки. Работает всегда — и когда ИИ недоступен. Свободный текст по-прежнему уходит агенту.
// Состояние фильтров — BotUser.browse; кнопки отправляют короткие команды (лимит callback_data Telegram — 64 байта).

export type Button = { label: string; command?: string; url?: string };
export type BrowseReply = { text: string; buttons: Button[][] };

type Browse = {
  city?: string;
  category?: string;
  when?: string; // today | tomorrow | weekend | week | YYYY-MM-DD
  free?: boolean;
  priceMax?: number;
  age?: number;
  pushkin?: boolean;
  offset?: number;
};

const eventUrl = (id: string) => `${process.env.PUBLIC_URL ?? ""}/events/${id}`;
const WHEN_LABEL: Record<string, string> = { today: "сегодня", tomorrow: "завтра", weekend: "на выходных", week: "на неделе" };
const fmtDay = (d: string) => new Date(`${d}T12:00:00+05:00`).toLocaleDateString("ru-RU", { timeZone: TZ, weekday: "short", day: "numeric", month: "long" });
const fmtWhen = (d: Date) => d.toLocaleString("ru-RU", { timeZone: TZ, weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const price = (e: { priceMin: number | null; priceMax: number | null }) =>
  e.priceMin === 0 && !e.priceMax ? "бесплатно" : e.priceMin != null ? (e.priceMax && e.priceMax !== e.priceMin ? `${e.priceMin}–${e.priceMax} ₽` : `${e.priceMin} ₽`) : "цена не указана";

/** Кнопка главного меню и типовые ряды. */
export const MAIN_MENU: Button[][] = [
  [
    { label: "Сегодня", command: "/f when=today" },
    { label: "Завтра", command: "/f when=tomorrow" },
  ],
  [
    { label: "Выходные", command: "/f when=weekend" },
    { label: "Неделя", command: "/f when=week" },
  ],
  [
    { label: "📍 Город", command: "/city" },
    { label: "🎭 Категория", command: "/cat" },
  ],
  [
    { label: "📅 Выбрать дату", command: "/when" },
    { label: "₽ Цена", command: "/price" },
  ],
  [
    { label: "Бесплатно", command: "/f free=1" },
    { label: "С ребёнком", command: "/f age=6" },
  ],
  [
    { label: "🔔 Подписки", command: "/subs" },
    { label: "❓ Помощь", command: "/help" },
  ],
];

export const HELP_TEXT = [
  "Как искать:",
  "• кнопками — дата, город, категория, цена; «Показать ещё» листает дальше;",
  "• или просто напишите, например: «концерт в Стерлитамаке в субботу до 1000 ₽» — подберу из афиши;",
  "• название события — найду по названию.",
  "",
  "Команды: /menu — меню, /today, /weekend, /free, /subs — подписки, /unsubscribe — отписаться от всех, /reminders — напоминания, /cancel — сбросить поиск, /help — эта справка.",
  "",
  "Подписка присылает новые события выбранного города и категории не чаще раза в день.",
].join("\n");

async function load(botUserId: string): Promise<Browse> {
  const u = await db.botUser.findUnique({ where: { id: botUserId }, select: { browse: true } });
  return (u?.browse as Browse | null) ?? {};
}
async function save(botUserId: string, b: Browse) {
  await db.botUser.update({ where: { id: botUserId }, data: { browse: b as Prisma.InputJsonValue } });
}

function dates(when?: string) {
  if (!when) return {};
  const p = datePresets();
  if (when === "today" || when === "tomorrow" || when === "weekend") return p[when];
  if (when === "week") return { dateFrom: localDay(0), dateTo: localDay(6) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(when)) return { dateFrom: when, dateTo: when };
  return {};
}

function describe(b: Browse, categories: Map<string, string>) {
  const parts = [
    b.city,
    b.category && categories.get(b.category),
    b.when && (WHEN_LABEL[b.when] ?? fmtDay(b.when)),
    b.free ? "бесплатно" : b.priceMax != null ? `до ${b.priceMax} ₽` : null,
    b.age != null && `с ребёнком ${b.age}+`,
    b.pushkin && "по Пушкинской карте",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "все события";
}

/** Фильтры бота → фильтр поиска через ту же схему, что у сайта и API (даты — начало и конец местного дня). */
const toFilter = (b: Browse, limit: number, offset = 0) =>
  eventFilterSchema.parse({
    city: b.city,
    category: b.category,
    ...dates(b.when),
    free: b.free,
    priceMax: b.priceMax,
    age: b.age,
    pushkin: b.pushkin,
    limit,
    offset,
  });

/** Строка события в списке: название, когда, где, цена, возраст. */
export function eventLine(e: EventItem, i: number, ageNote = false) {
  const status = e.status === "RESCHEDULED" ? " (перенесено)" : e.status === "SOLD_OUT" ? " (билетов нет)" : "";
  // Многодневное, уже открытое (выставка) — «идёт до …», а не дата открытия в прошлом
  const ongoing = e.endsAt && e.endsAt.getTime() - e.startsAt.getTime() > 86_400_000 && e.startsAt < new Date();
  const when = ongoing ? `идёт до ${e.endsAt!.toLocaleDateString("ru-RU", { timeZone: TZ, day: "numeric", month: "long" })}` : fmtWhen(e.startsAt);
  return `${i}. ${e.title}${status}\n   ${when} ·${e.venue ? `${e.venue.name}, ${e.venue.city}` : ""} · ${price(e)}${e.ageLimit != null ? ` · ${e.ageLimit}+` : ageNote ? " · возраст не указан — уточните у организатора" : ""}`;
}

/** Ряд фильтров под списком. */
const FILTER_ROWS: Button[][] = [
  [
    { label: "📍 Город", command: "/city" },
    { label: "🎭 Категория", command: "/cat" },
    { label: "📅 Дата", command: "/when" },
  ],
  [
    { label: "₽ Цена", command: "/price" },
    { label: "🔔 Подписаться", command: "/sub" },
    { label: "✕ Сбросить", command: "/f reset" },
  ],
];

/** Список событий по текущим фильтрам; пусто — объясняем, какое условие мешает (ТЗ 6.1). */
async function list(botUserId: string, b: Browse): Promise<BrowseReply> {
  const page = (await getSettings("tuning")).botEvents;
  const categories = new Map((await db.category.findMany()).map((c) => [c.slug, c.name]));
  const offset = b.offset ?? 0;
  const { items, total } = await searchEvents(toFilter(b, page, offset));
  const title = describe(b, categories);
  if (!items.length && offset === 0) {
    // Какое ограничение ослабить: пробуем убрать по одному и считаем, сколько найдётся
    const hints: Button[] = [];
    const tries: [keyof Browse, string][] = [
      ["when", "без даты"],
      ["category", "любая категория"],
      ["city", "все города"],
      ["priceMax", "любая цена"],
      ["free", "не только бесплатные"],
      ["age", "любой возраст"],
    ];
    const notes: string[] = [];
    for (const [key, label] of tries) {
      if (b[key] == null) continue;
      const n = (await searchEvents(toFilter({ ...b, [key]: undefined }, 1))).total;
      if (n) {
        notes.push(`${label} — ${n}`);
        hints.push({ label: `${label[0].toUpperCase()}${label.slice(1)} (${n})`, command: `/f ${key}=` });
      }
    }
    return {
      text: `По условиям «${title}» в афише ничего нет.${notes.length ? `\nЕсли ослабить условие: ${notes.join("; ")}.` : " Попробуйте другие условия."}`,
      buttons: [...hints.slice(0, 4).map((h) => [h]), ...FILTER_ROWS],
    };
  }
  const shown = offset + items.length;
  const lines = items.map((e, i) => eventLine(e, offset + i + 1));
  return {
    text: `${title[0].toUpperCase()}${title.slice(1)} — найдено ${total}:\n\n${lines.join("\n\n")}\n\nОткройте событие кнопкой — покажу всё: адрес, цену, источник и билеты.`,
    buttons: [
      ...items.map((e, i) => [{ label: `${offset + i + 1}. ${e.title}`.slice(0, 60), command: `/e ${e.id}` }]),
      ...(shown < total ? [[{ label: `Показать ещё (${shown} из ${total})`, command: "/more" }]] : []),
      ...FILTER_ROWS,
    ],
  };
}

/** Полная карточка события (ТЗ 6.2): категория, когда, где, адрес, описание, цена, возраст, источник, билеты. */
async function card(id: string): Promise<BrowseReply> {
  const e = await db.event.findFirst({ where: { id, publication: "PUBLISHED" }, include: { venue: true, category: true, sources: true } });
  if (!e) return { text: "Событие не найдено — возможно, его убрали из афиши.", buttons: [[{ label: "← К списку", command: "/list" }]] };
  const end = e.endsAt && e.endsAt.getTime() - e.startsAt.getTime() > 86_400_000 ? ` — до ${e.endsAt.toLocaleDateString("ru-RU", { timeZone: TZ, day: "numeric", month: "long" })}` : "";
  const status =
    e.status === "CANCELLED"
      ? "❗ Отменено"
      : e.status === "RESCHEDULED"
        ? `❗ Перенесено${e.originalStartsAt ? ` (было ${fmtWhen(e.originalStartsAt)})` : ""}`
        : e.status === "SOLD_OUT"
          ? "Билетов нет"
          : e.status === "PAST"
            ? "Уже прошло"
            : "";
  const text = [
    e.category?.name ?? "Событие",
    `«${e.title}»`,
    status,
    `📅 ${fmtWhen(e.startsAt)}${end}`,
    e.venue ? `📍 ${e.venue.city}, ${e.venue.name}${e.venue.address ? `, ${e.venue.address}` : ""}` : "",
    `💳 ${price(e)}${e.pushkinCard ? " · Пушкинская карта" : ""}`,
    e.ageLimit != null ? `👤 ${e.ageLimit}+` : "",
    e.language ? `🗣 ${e.language}` : "",
    e.description ? `\n${e.description.length > 600 ? `${e.description.slice(0, 600)}…` : e.description}` : "",
    `\nИсточник: ${e.sources[0]?.url ?? "—"}`,
  ]
    .filter(Boolean)
    .join("\n");
  const links: Button[] = [
    ...(e.sources[0] ? [{ label: "Источник", url: e.sources[0].url }] : []),
    ...(e.ticketUrl && e.status !== "CANCELLED" && e.status !== "PAST" ? [{ label: "Билеты", url: e.ticketUrl }] : []),
    { label: "На сайте", url: eventUrl(e.id) },
  ];
  return {
    text,
    buttons: [links, [...(e.status !== "CANCELLED" && e.status !== "PAST" ? [{ label: "🔔 Напомнить", command: `/remind ${e.id}` }] : []), { label: "← К списку", command: "/list" }]],
  };
}

async function chooser(kind: "city" | "cat" | "when" | "price"): Promise<BrowseReply> {
  const back: Button[] = [{ label: "← К списку", command: "/list" }];
  if (kind === "city") {
    const { cities } = await filterOptions();
    const rows: Button[][] = [];
    for (let i = 0; i < cities.length; i += 2) rows.push(cities.slice(i, i + 2).map((c) => ({ label: c, command: `/f city=${c}` })));
    return { text: "Выберите город (в списке — те, где есть события). Можно и написать: «концерты в Белорецке».", buttons: [...rows.slice(0, 10), [{ label: "Все города", command: "/f city=" }], back] };
  }
  if (kind === "cat") {
    const { categories } = await filterOptions();
    const rows: Button[][] = [];
    for (let i = 0; i < categories.length; i += 2) rows.push(categories.slice(i, i + 2).map((c) => ({ label: c.name, command: `/f category=${c.slug}` })));
    return { text: "Выберите категорию:", buttons: [...rows, [{ label: "Все категории", command: "/f category=" }], back] };
  }
  if (kind === "when") {
    const days = Array.from({ length: 8 }, (_, i) => localDay(i + 2));
    const rows: Button[][] = [
      [
        { label: "Сегодня", command: "/f when=today" },
        { label: "Завтра", command: "/f when=tomorrow" },
      ],
      [
        { label: "Выходные", command: "/f when=weekend" },
        { label: "Неделя", command: "/f when=week" },
      ],
    ];
    for (let i = 0; i < days.length; i += 2) rows.push(days.slice(i, i + 2).map((d) => ({ label: fmtDay(d), command: `/f when=${d}` })));
    return { text: "Когда? Выберите день или период (другую дату можно написать: «12 декабря»).", buttons: [...rows, [{ label: "Любая дата", command: "/f when=" }], back] };
  }
  return {
    text: "Сколько готовы потратить на билет?",
    buttons: [
      [
        { label: "Бесплатно", command: "/f free=1" },
        { label: "до 500 ₽", command: "/f priceMax=500" },
      ],
      [
        { label: "до 1000 ₽", command: "/f priceMax=1000" },
        { label: "до 2000 ₽", command: "/f priceMax=2000" },
      ],
      [{ label: "Любая цена", command: "/f priceMax=" }],
      back,
    ],
  };
}

// ── Подписки ─────────────────────────────────────────────────────────────────

async function subscribeConfirm(botUserId: string): Promise<BrowseReply> {
  const b = await load(botUserId);
  const categories = new Map((await db.category.findMany()).map((c) => [c.slug, c.name]));
  const what = [b.city ?? "все города", b.category ? categories.get(b.category) : "все категории"].join(" · ");
  // Изменение данных — только после подтверждения кнопкой (ТЗ 6.5)
  return {
    text: `Подписаться на новые события: ${what}?\nПришлю не чаще раза в день и только если появится новое. Отписаться — /unsubscribe.`,
    buttons: [
      [
        { label: "✓ Да, подписаться", command: "/sub yes" },
        { label: "Нет", command: "/list" },
      ],
      [{ label: "Сначала выбрать город", command: "/city" }],
    ],
  };
}

async function subscribe(botUserId: string): Promise<BrowseReply> {
  const b = await load(botUserId);
  const city = b.city ?? null;
  const category = b.category ?? null;
  const exists = await db.subscription.findFirst({ where: { botUserId, city, category } });
  if (!exists) {
    if ((await db.subscription.count({ where: { botUserId } })) >= 10) return { text: "Подписок уже 10 — удалите лишние в /subs.", buttons: [[{ label: "Мои подписки", command: "/subs" }]] };
    await db.subscription.create({ data: { botUserId, city, category } });
  }
  return { text: exists ? "Такая подписка уже есть." : "Готово! Пришлю новые события, когда они появятся в афише.", buttons: [[{ label: "Мои подписки", command: "/subs" }, { label: "← К списку", command: "/list" }]] };
}

async function subscriptions(botUserId: string): Promise<BrowseReply> {
  const subs = await db.subscription.findMany({ where: { botUserId }, orderBy: { createdAt: "asc" } });
  const categories = new Map((await db.category.findMany()).map((c) => [c.slug, c.name]));
  const name = (s: { city: string | null; category: string | null }) => [s.city ?? "все города", s.category ? (categories.get(s.category) ?? s.category) : "все категории"].join(" · ");
  if (!subs.length)
    return { text: "Подписок нет. Выберите город и категорию и нажмите «🔔 Подписаться» — пришлю новые события не чаще раза в день.", buttons: [[{ label: "📍 Выбрать город", command: "/city" }], [{ label: "Меню", command: "/menu" }]] };
  return {
    text: `Ваши подписки:\n${subs.map((s) => `• ${name(s)}`).join("\n")}\n\nНажмите, чтобы отписаться. Отписаться от всех — /unsubscribe.`,
    buttons: [...subs.map((s) => [{ label: `✕ ${name(s)}`.slice(0, 60), command: `/unsub ${s.id}` }]), [{ label: "Меню", command: "/menu" }]],
  };
}

// ── Разбор команд ────────────────────────────────────────────────────────────

const ALLOWED: (keyof Browse)[] = ["city", "category", "when", "free", "priceMax", "age", "pushkin"];

/** Команда поиска кнопками → ответ; не наша команда — null (уходит агенту или в другие обработчики). */
export async function browseCommand(botUserId: string, text: string): Promise<BrowseReply | null> {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ");
  switch (cmd.toLowerCase().replace(/@\w+$/, "")) {
    case "/menu":
      return { text: "Что ищем? Выберите период или фильтр — или просто напишите запрос своими словами.", buttons: MAIN_MENU };
    case "/help":
      return { text: HELP_TEXT, buttons: [[{ label: "Меню", command: "/menu" }]] };
    case "/cancel":
      await db.botUser.update({ where: { id: botUserId }, data: { browse: {}, dialog: [] } });
      return { text: "Поиск сброшен.", buttons: MAIN_MENU };
    case "/city":
      return chooser("city");
    case "/cat":
      return chooser("cat");
    case "/when":
      return chooser("when");
    case "/price":
      return chooser("price");
    case "/list":
      return list(botUserId, await load(botUserId));
    case "/more": {
      const b = await load(botUserId);
      const next = { ...b, offset: (b.offset ?? 0) + (await getSettings("tuning")).botEvents };
      await save(botUserId, next);
      return list(botUserId, next);
    }
    case "/e":
      return card(arg);
    case "/sub":
      return arg === "yes" ? subscribe(botUserId) : subscribeConfirm(botUserId);
    case "/subs":
      return subscriptions(botUserId);
    case "/unsub":
      await db.subscription.deleteMany({ where: { id: arg, botUserId } });
      return subscriptions(botUserId);
    case "/unsubscribe": {
      const { count } = await db.subscription.deleteMany({ where: { botUserId } });
      return { text: count ? `Отписал от всех подписок (${count}). Больше уведомлений не будет.` : "Подписок не было.", buttons: [[{ label: "Меню", command: "/menu" }]] };
    }
    case "/f": {
      // /f key=value — изменить фильтр (пустое значение — снять); /f reset — сбросить все
      let b = await load(botUserId);
      if (arg === "reset") b = {};
      else {
        const m = arg.match(/^(\w+)=(.*)$/);
        const key = m?.[1] as keyof Browse | undefined;
        if (!m || !key || !ALLOWED.includes(key)) return null;
        const value = m[2].trim();
        const next: Browse = { ...b };
        if (!value) delete next[key];
        else if (key === "free" || key === "pushkin") next[key] = value === "1";
        else if (key === "priceMax" || key === "age") next[key] = Math.max(0, parseInt(value, 10) || 0);
        else if (key === "city" || key === "category" || key === "when") next[key] = value.slice(0, 60);
        if (key === "free" && next.free) delete next.priceMax;
        if (key === "priceMax" && next.priceMax != null) delete next.free;
        b = next;
      }
      b.offset = 0;
      await save(botUserId, b);
      return list(botUserId, b);
    }
  }
  return null;
}

/** Рассылка по подпискам: новые события с прошлой рассылки, не больше 5 в сообщении. */
export async function subscriptionDigest(sub: { city: string | null; category: string | null; notifiedUpTo: Date }) {
  const { items } = await searchEvents({ city: sub.city ?? undefined, category: sub.category ?? undefined, limit: 50, offset: 0 });
  const fresh = items.filter((e) => e.createdAt > sub.notifiedUpTo).slice(0, 5);
  return fresh;
}
