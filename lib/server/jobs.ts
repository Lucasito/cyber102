import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { TZ } from "./events";
import { BOTS_PAUSED, getSettings } from "./settings";

// Фоновые задачи (запуск — instrumentation.ts): раз в минуту.
//  • Прошедшие события получают статус PAST — в API и админке статус соответствует действительности.
//  • Отправка напоминаний из ботов.
//  • Раз в час — очистка по срокам хранения (RETENTION).

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
type Sender = (externalId: string, text: string, link?: { title: string; url: string }) => Promise<void>;
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
      await send(r.botUser.externalId, text, { title: e.title, url: `${process.env.PUBLIC_URL ?? ""}/events/${e.id}` });
      await db.reminder.update({ where: { id: r.id }, data: { sentAt: new Date() } });
    } catch (err) {
      console.error(`[jobs] напоминание ${r.id} не отправлено:`, err instanceof Error ? err.message : err);
      // Не удаётся больше суток — бросаем, чтобы не слать бесконечно
      if (Date.now() - r.remindAt.getTime() > 86_400_000) await db.reminder.update({ where: { id: r.id }, data: { sentAt: new Date(0) } });
    }
  }
}

/** Сроки хранения (ТЗ, раздел 10: персональные данные — минимум, срок хранения указан в README). */
export const RETENTION = { dialogDays: 30, queryLogDays: 180 } as const;
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
  ]);
}

let started = false;
export function startJobs() {
  if (started) return;
  started = true;
  const tick = async () => {
    await markPastEvents().catch((e) => console.error("[jobs] статусы:", e instanceof Error ? e.message : e));
    await sendDueReminders().catch((e) => console.error("[jobs] напоминания:", e instanceof Error ? e.message : e));
    await purgeOldData().catch((e) => console.error("[jobs] очистка:", e instanceof Error ? e.message : e));
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
