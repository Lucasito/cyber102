import "server-only";
import { runAgent } from "./agent";
import { AiError, type ChatMessage } from "./ai";
import { browseCommand, eventLine, MAIN_MENU, type Button } from "./bot-browse";
import { db } from "./db";
import { TZ } from "./events";
import { reminderTime } from "./jobs";
import { rateLimit } from "./rate-limit";
import { DEFAULT_BOT_GREETING, getSettings } from "./settings";

// Общая логика ботов (MAX, Telegram): приветствие, меню, диалог с ИИ-агентом, напоминания, лимиты.
// Платформенные модули только отображают BotReply своими средствами (кнопки, клавиатуры).

export type Platform = "max" | "telegram";

export type BotReply = {
  text: string;
  /** Кнопки-ссылки на события; с eventId — рядом кнопка «Напомнить». */
  links: { title: string; url: string; eventId?: string }[];
  /** Кнопки-подсказки: нажатие отправляет этот текст как сообщение. */
  suggestions: string[];
  /** Кнопки-действия: нажатие отправляет команду (её текст пользователь не видит). */
  actions?: { label: string; command: string }[];
  /** Ряды кнопок поиска кнопками: команда (callback) или ссылка. Показываются после links и actions. */
  buttons?: Button[][];
};

/**
 * Команды меню (видны по «/»). query — во что превращается команда: в команду поиска кнопками
 * (работает без ИИ) или в служебное действие; null — обрабатывается как есть.
 */
export const BOT_COMMANDS = [
  { command: "start", description: "Начать заново", query: null },
  { command: "menu", description: "Меню поиска", query: null },
  { command: "today", description: "Что идёт сегодня", query: "/f when=today" },
  { command: "weekend", description: "Куда сходить на выходных", query: "/f when=weekend" },
  { command: "free", description: "Бесплатные события", query: "/f free=1" },
  { command: "kids", description: "Куда сходить с ребёнком", query: "/f age=6" },
  { command: "pushkin", description: "По Пушкинской карте", query: "/f pushkin=1" },
  { command: "subs", description: "Мои подписки", query: null },
  { command: "unsubscribe", description: "Отписаться от всех", query: null },
  { command: "reminders", description: "Мои напоминания", query: null },
  { command: "cancel", description: "Сбросить поиск", query: null },
  { command: "help", description: "Как пользоваться", query: null },
] as const;

const RESET = /^(\/start|\/new|новый поиск|начать заново|сброс)(?![а-яё\w])/i;

/**
 * Пользователь бота: только идентификатор в мессенджере. Имя не храним (ТЗ: персональные данные — минимум);
 * у записанных раньше оно стирается при следующем сообщении.
 */
export async function touchBotUser(platform: Platform, externalId: string) {
  return db.botUser.upsert({
    where: { platform_externalId: { platform, externalId } },
    create: { platform, externalId, name: null },
    update: { name: null, lastSeenAt: new Date() },
  });
}

/** Пометка в приветствии: сервис не является официальным сервисом министерства (ТЗ, «красные линии»). */
export const BOT_DISCLAIMER = "Сервис неофициальный: события — из открытых источников, у каждого есть ссылка на источник.";
/** Под подборкой: ответ построен по данным афиши, а не «мнению модели» (ТЗ 6.4). */
const DATA_NOTE = "Подборка — из афиши, подробности и источник — по кнопкам.";
const DEGRADED_NOTE = "ИИ сейчас недоступен — подобрал обычным поиском по вашим условиям.";

/** Команда «/today» (или «/today@bot») → текст запроса. Служебные команды возвращаются как есть. */
function commandToQuery(text: string) {
  const m = text.match(/^\/(\w+)(@\w+)?\s*(.*)$/s);
  if (!m) return text;
  const cmd = BOT_COMMANDS.find((c) => c.command === m[1].toLowerCase());
  if (!cmd) return text;
  return cmd.query ?? `/${cmd.command}${m[3] ? ` ${m[3]}` : ""}`;
}

/** Приветствие с главным меню на кнопках под сообщением (ТЗ 6.2: без «простыни» текста). */
export function greetingReply(greeting?: string): BotReply {
  return { text: `${greeting || DEFAULT_BOT_GREETING}\n\n${BOT_DISCLAIMER}`, links: [], suggestions: [], buttons: MAIN_MENU };
}

const fmtWhen = (d: Date) => d.toLocaleString("ru-RU", { timeZone: TZ, weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const eventUrl = (id: string) => `${process.env.PUBLIC_URL ?? ""}/events/${id}`;

// ───────── Напоминания ─────────

async function remind(botUserId: string, eventId: string): Promise<BotReply> {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) return { text: "Событие не найдено — возможно, его убрали из афиши.", links: [], suggestions: [] };
  const T = await getSettings("tuning");
  const at = reminderTime(event, new Date(), T);
  if (!at) return { text: `«${event.title}» скоро начнётся — напоминать уже поздно.`, links: [{ title: event.title, url: eventUrl(event.id) }], suggestions: [] };
  await db.reminder.upsert({
    where: { botUserId_eventId: { botUserId, eventId } },
    create: { botUserId, eventId, remindAt: at },
    update: { remindAt: at, sentAt: null },
  });
  return {
    text: `Напомню о «${event.title}» ${fmtWhen(at)}.`,
    links: [],
    suggestions: [],
    actions: [{ label: "Мои напоминания", command: "/reminders" }],
  };
}

async function listReminders(botUserId: string): Promise<BotReply> {
  const list = await db.reminder.findMany({
    where: { botUserId, sentAt: null },
    include: { event: true },
    orderBy: { remindAt: "asc" },
    take: 10,
  });
  if (!list.length) return { text: "Напоминаний нет. Нажмите «🔔» под событием в подборке — напомню за день до начала.", links: [], suggestions: [], buttons: MAIN_MENU };
  return {
    text: "Ваши напоминания:\n" + list.map((r) => `• ${r.event.title} — ${fmtWhen(r.event.startsAt)} (напомню ${fmtWhen(r.remindAt)})`).join("\n"),
    links: [],
    suggestions: [],
    actions: list.map((r) => ({ label: `✕ ${r.event.title.slice(0, 40)}`, command: `/unremind ${r.eventId}` })),
  };
}

// ───────── Ответ на сообщение ─────────

export async function botAnswer(platform: Platform, externalId: string, rawText: string, greeting?: string): Promise<BotReply> {
  const user = await touchBotUser(platform, externalId);
  const text = commandToQuery(rawText.trim()).slice(0, 1000);

  // Новый поиск: забываем прежний диалог и фильтры
  if (RESET.test(text)) {
    await db.botUser.update({ where: { id: user.id }, data: { dialog: [], browse: {} } });
    return /^\/start/i.test(text)
      ? greetingReply(greeting)
      : { text: "Хорошо, начнём заново. Что ищете? Выберите кнопкой или напишите своими словами.", links: [], suggestions: [], buttons: MAIN_MENU };
  }
  // Поиск кнопками, карточка события, подписки, /help, /cancel — без ИИ
  if (text.startsWith("/")) {
    const browsed = await browseCommand(user.id, text);
    if (browsed) return { text: browsed.text, links: [], suggestions: [], buttons: browsed.buttons };
  }
  // Напоминания
  const rem = text.match(/^\/(remind|unremind)\s+(\S+)/);
  if (rem?.[1] === "remind") return remind(user.id, rem[2]);
  if (rem?.[1] === "unremind") {
    await db.reminder.deleteMany({ where: { botUserId: user.id, eventId: rem[2] } });
    return listReminders(user.id);
  }
  if (/^\/reminders/.test(text)) return listReminders(user.id);

  // Лимит на пользователя — защищает токены ИИ от спама в боте
  const limited = await rateLimit(`bot:${platform}:${externalId}`, "user");
  if (limited) return { text: limited.message, links: [], suggestions: [] };

  // Без ИИ агент работает по правилам и шаблону (резервный режим, ТЗ 7.5) — пользователю не отказываем

  const T = await getSettings("tuning");
  const history = [...((user.dialog as ChatMessage[] | null) ?? []), { role: "user" as const, content: text }].slice(-T.dialogMemory);
  try {
    const result = await runAgent(history, { source: platform, userKey: `${platform}:${externalId}` });
    await db.botUser.update({
      where: { id: user.id },
      data: { dialog: [...history, { role: "assistant", content: result.text }].slice(-T.dialogMemory), messages: { increment: 1 } },
    });
    const events = result.events.slice(0, T.botEvents);
    const list = events.map((e, i) => eventLine(e, i + 1)).join("\n\n");
    const notes = [result.degraded ? DEGRADED_NOTE : "", DATA_NOTE].filter(Boolean).join("\n");
    return {
      text: list ? `${result.text}\n\n${list}\n\n${notes}` : result.text,
      links: [],
      suggestions: result.suggestions.filter((s) => !/^новый поиск$/i.test(s)),
      // Событие открывается карточкой прямо в боте (адрес, цена, источник, билеты), рядом — напоминание
      buttons: [
        ...events.map((e, i) => [
          { label: `${i + 1}. ${e.title}`.slice(0, 60), command: `/e ${e.id}` },
          { label: "🔔", command: `/remind ${e.id}` },
        ]),
        [
          { label: "Меню", command: "/menu" },
          { label: "Новый поиск", command: "/new" },
        ],
      ],
    };
  } catch (e) {
    console.error(`[${platform}] агент:`, e);
    return { text: e instanceof AiError ? e.message : "Не получилось подобрать события, попробуйте ещё раз.", links: [], suggestions: ["Новый поиск"] };
  }
}
