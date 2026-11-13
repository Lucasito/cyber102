import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { geocodeVenues } from "./geocode";
import { TZ, type EventItem } from "./events";
import { eventLine, subscriptionDigest } from "./bot-browse";
import { BOTS_PAUSED, getSettings } from "./settings";

// Фоновые задачи (запуск — instrumentation.ts): раз в минуту.
//  • Прошедшие события получают статус PAST — в API и админке статус соответствует действительности.
//  • Отправка напоминаний из ботов.
//  • Раз в 5 минут — координаты площадок по адресу (Nominatim). Раз в час — очистка по срокам хранения (RETENTION) и рассылка по подпискам (с 10:00, не чаще раза в день).

const MINUTE = 60_000;

export async function markPastEvents() {
  // Событие без даты окончания считаем закончившимся через N часов после начала (настройка «Параметры»)
  const hours = (await getSettings("tuning")).defaultDurationHours;
  const n = await db.$executeRawUnsafe(
    `UPDATE "Event" SET status = 'PAST', "updatedAt" = now()
     WHERE status IN ('SCHEDULED', 'RESCHEDULED', 'SOLD_OUT')
       AND COALESCE("endsAt", "startsAt" + make_interval(mins => $1::int)) < now()`,
    Math.round(hours * 60),
  );
  if (n) console.log(`[jobs] прошедших событий: ${n}`);
  return n;
}

/** Отправщики сообщений платформ — регистрируются модулями ботов, чтобы не было циклических импортов. */
type Sender = (externalId: string, text: string, links: { title: string; url: string }[]) => Promise<void>;
const senders = new Map<string, Sender>();
export function registerSender(platform: string, send: Sender) {
  senders.set(platform, send);
}

export async function sendDueReminders() {
  // Боты на паузе — напоминания не шлём и не помечаем, отправятся после включения
  if (BOTS_PAUSED) return;
  const due = await db.reminder.findMany({
    where: { sentAt: null, remindAt: { lte: new Date() } },
    include: { botUser: true, event: { include: { venue: true } } },
    take: 50,
  });
  for (const r of due) {
    const send = senders.get(r.botUser.platform);
    if (!send) continue;
    const e = r.event;
    const when = e.startsAt.toLocaleString("ru-RU", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    const multiDay = !!e.endsAt && e.endsAt.getTime() - e.startsAt.getTime() > 86_400_000;
    const text =
      e.status === "CANCELLED"
        ? `К сожалению, «${e.title}» отменено.`
        : multiDay
          ? `Напоминание: «${e.title}» идёт до ${e.endsAt!.toLocaleDateString("ru-RU", { timeZone: TZ, day: "numeric", month: "long" })} — успейте посетить.${e.venue ? `\n${e.venue.name}, ${e.venue.city}` : ""}`
          : `Напоминание: «${e.title}» — ${when}.${e.venue ? `\n${e.venue.name}, ${e.venue.city}${e.venue.address ? `, ${e.venue.address}` : ""}` : ""}` +
            (e.status === "RESCHEDULED" ? "\nОбратите внимание: событие было перенесено." : "");
    try {
      await send(r.botUser.externalId, text, [{ title: e.title, url: `${process.env.PUBLIC_URL ?? ""}/events/${e.id}` }]);
      await db.reminder.update({ where: { id: r.id }, data: { sentAt: new Date() } });
    } catch (err) {
      console.error(`[jobs] напоминание ${r.id} не отправлено:`, err instanceof Error ? err.message : err);
      // Не удаётся больше суток — бросаем, чтобы не слать бесконечно
      if (Date.now() - r.remindAt.getTime() > 86_400_000) await db.reminder.update({ where: { id: r.id }, data: { sentAt: new Date(0) } });
    }
  }
}

/**
 * Рассылка по подпискам (ТЗ 6.2: без навязчивых уведомлений): с 10:00 местного времени, проверка раз в час,
 * каждому — не чаще раза в 20 часов, одно сообщение со всеми новыми событиями его подписок; нового нет — молчим.
 */
let lastDigestRun = 0;
export async function sendSubscriptionDigests() {
  if (BOTS_PAUSED) return;
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false }));
  if (hour < 10 || hour >= 21 || Date.now() - lastDigestRun < 60 * MINUTE) return;
  lastDigestRun = Date.now();
  // Только подписки из ботов: у подписок через API — своя лента по ссылке
  const due = await db.subscription.findMany({ where: { botUserId: { not: null }, notifiedUpTo: { lt: new Date(Date.now() - 20 * 60 * MINUTE) } }, include: { botUser: true } });
  const byUser = new Map<string, typeof due>();
  for (const s of due) if (s.botUserId) byUser.set(s.botUserId, [...(byUser.get(s.botUserId) ?? []), s]);
  const base = process.env.PUBLIC_URL ?? "";
  for (const subs of byUser.values()) {
    const user = subs[0].botUser;
    if (!user) continue;
    const send = senders.get(user.platform);
    if (!send) continue;
    const seen = new Map<string, EventItem>();
    for (const s of subs) for (const e of await subscriptionDigest(s)) seen.set(e.id, e);
    const events = [...seen.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, 8);
    if (!events.length) continue;
    const list = events.map((e, i) => eventLine(e, i + 1)).join("\n\n");
    const text = `Новое в афише по вашим подпискам:\n\n${list}\n\nПодписки — /subs, отписаться от всех — /unsubscribe.`;
    try {
      await send(user.externalId, text, events.map((e) => ({ title: e.title, url: `${base}/events/${e.id}` })));
      await db.subscription.updateMany({ where: { id: { in: subs.map((s) => s.id) } }, data: { notifiedUpTo: new Date() } });
    } catch (err) {
      console.error(`[jobs] рассылка подписки не отправлена:`, err instanceof Error ? err.message : err);
    }
  }
}

/** Сроки хранения (ТЗ, раздел 10: персональные данные — минимум, срок хранения указан в README). */
export const RETENTION = { dialogDays: 30, queryLogDays: 180, feedbackDays: 365 } as const;
let lastPurge = 0;

/** Раз в час: диалоги неактивных пользователей ботов, старые запросы аналитики, истёкшие сессии и ссылки из писем. */
export async function purgeOldData() {
  if (Date.now() - lastPurge < 60 * MINUTE) return;
  lastPurge = Date.now();
  const day = 86_400_000;
  const now = new Date();
  await db.$transaction([
    db.botUser.updateMany({ where: { lastSeenAt: { lt: new Date(Date.now() - RETENTION.dialogDays * day) }, NOT: { dialog: { equals: Prisma.DbNull } } }, data: { dialog: Prisma.DbNull } }),
    db.queryLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION.queryLogDays * day) } } }),
    db.adminSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.adminToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.feedback.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION.feedbackDays * day) } } }),
  ]);
}

let started = false;
let lastGeocode = 0;
export function startJobs() {
  if (started) return;
  started = true;
  const tick = async () => {
    await markPastEvents().catch((e) => console.error("[jobs] статусы:", e instanceof Error ? e.message : e));
    await sendDueReminders().catch((e) => console.error("[jobs] напоминания:", e instanceof Error ? e.message : e));
    await purgeOldData().catch((e) => console.error("[jobs] очистка:", e instanceof Error ? e.message : e));
    await sendSubscriptionDigests().catch((e) => console.error("[jobs] подписки:", e instanceof Error ? e.message : e));
    // Координаты площадок по адресу — раз в 5 минут, понемногу (правила Nominatim)
    if (Date.now() - lastGeocode > 5 * MINUTE) {
      lastGeocode = Date.now();
      await geocodeVenues().catch((e) => console.error("[jobs] координаты:", e instanceof Error ? e.message : e));
    }
  };
  setTimeout(tick, 15_000); // после старта — дать подняться ботам
  setInterval(tick, MINUTE);
}

type ReminderTuning = { remindHours: number; remindFallbackHours: number; exhibitionRemindDays: number };

/** Когда напомнить: обычное событие — за remindHours (или за remindFallbackHours, если до начала меньше); выставка — за exhibitionRemindDays до закрытия. */
export function reminderTime(
  e: { startsAt: Date; endsAt: Date | null },
  now = new Date(),
  t: ReminderTuning = { remindHours: 24, remindFallbackHours: 2, exhibitionRemindDays: 2 },
): Date | null {
  const multiDay = !!e.endsAt && e.endsAt.getTime() - e.startsAt.getTime() > 86_400_000;
  if (multiDay) {
    const at = new Date(e.endsAt!.getTime() - t.exhibitionRemindDays * 86_400_000);
    return at > now ? at : e.endsAt! > now ? new Date(now.getTime() + MINUTE) : null;
  }
  const main = new Date(e.startsAt.getTime() - t.remindHours * 3_600_000);
  if (main > now) return main;
  const fallback = new Date(e.startsAt.getTime() - t.remindFallbackHours * 3_600_000);
  if (fallback > now) return fallback;
  return null; // до начала совсем мало — напоминать поздно
}
