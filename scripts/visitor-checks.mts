import assert from "node:assert/strict";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { parseFavoriteIds, toggleFavoriteId } from "../lib/favorites.ts";
import { calendar } from "../lib/ical.ts";
import { planDay, planInputSchema } from "../lib/server/planner.ts";
import { dedupKey } from "../lib/server/normalize.ts";
import { botAnswer } from "../lib/server/bot-core.ts";
import { sendEventWatchUpdates, subscribeToEvent } from "../lib/server/event-watches.ts";
import { purgeOldData } from "../lib/server/jobs.ts";

type Check = (name: string, fn: () => unknown | Promise<unknown>) => Promise<void>;

export async function visitorChecks(db: PrismaClient, check: Check) {
  await check("избранное принимает только ID, удаляет дубли и переживает повреждённое хранилище", () => {
    assert.deepEqual(parseFavoriteIds('{"broken":true}'), []);
    assert.deepEqual(parseFavoriteIds('not-json'), []);
    assert.deepEqual(parseFavoriteIds('["event-1", "event-1", "<script>", 12, "event_2"]'), ["event-1", "event_2"]);
    assert.deepEqual(toggleFavoriteId(["one"], "one"), []);
    assert.throws(() => toggleFavoriteId(Array.from({ length: 100 }, (_, i) => `id-${i}`), "extra"), /favorites_limit/);
  });
  await check("план отклоняет несуществующие даты, время и противоречивые остановки", () => {
    assert.equal(planInputSchema.safeParse({ date: "2027-02-30" }).success, false);
    assert.equal(planInputSchema.safeParse({ date: "2028-02-29", from: "25:00" }).success, false);
    assert.equal(planInputSchema.safeParse({ date: "2028-02-29", keep: "one", exclude: "one" }).success, false);
    assert.equal(planInputSchema.safeParse({ date: "2028-02-29", from: "9:00" }).success, true);
  });
  const date = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const at = (hm: string) => new Date(`${date}T${hm}:00+05:00`);
  const venue = await db.venue.create({ data: { name: "Площадка посетительских проверок", city: "Уфа", address: "Тестовая улица, 1", lat: 54.73, lon: 55.95 } });
  const hall = await db.venue.create({ data: { name: "Тестовый зал", city: "Уфа", buildingId: venue.id, address: venue.address, lat: venue.lat, lon: venue.lon } });
  const events = [];
  for (const [title, start, end, price, venueId] of [
    ["Утренний концерт", "10:00", "11:00", 100, venue.id],
    ["Дневная программа", "13:00", "14:00", 100, hall.id],
    ["Вечерний спектакль", "16:00", "17:00", 100, venue.id],
    ["Альтернативная программа", "13:15", "14:15", 150, hall.id],
  ] as const) events.push(await db.event.create({ data: { title, normalizedTitle: title.toLowerCase(), startsAt: at(start), endsAt: at(end), venueId, ageLimit: 0, priceMin: price, priceMax: price,
    dedupKey: dedupKey(title, at(start), venueId === venue.id ? venue.name : hall.name, "Уфа") } }));
  const input = { date, city: "Уфа", budget: 800, persons: 2, age: 6, count: 3 };
  await check("план учитывает цену на всех и перемещение между залами одного здания", async () => {
    const plan = await planDay(input); assert.ok(plan.ok);
    assert.deepEqual(plan.items.map((p) => p.event.id), events.slice(0, 3).map((e) => e.id));
    assert.equal(plan.totalCost, 600); assert.equal(plan.travelMin, 0);
    assert.equal(plan.unknownPrice, false); assert.ok(plan.items.every((p) => !p.durationEstimated));
  });
  await check("замена одной остановки сохраняет две остальные и бюджет", async () => {
    const plan = await planDay({ ...input, keep: [events[0].id, events[2].id], exclude: [events[1].id] }); assert.ok(plan.ok);
    assert.deepEqual(plan.items.map((p) => p.event.id), [events[0].id, events[3].id, events[2].id]); assert.equal(plan.totalCost, 700);
    const impossible = await planDay({ ...input, keep: [events[0].id, events[2].id], exclude: [events[1].id, events[3].id] }); assert.equal(impossible.ok, false);
  });
  await check("общая ссылка проверяет доступность выбранных событий заново", async () => {
    await db.event.update({ where: { id: events[1].id }, data: { status: "CANCELLED" } });
    assert.equal((await planDay({ ...input, keep: events.slice(0, 3).map((e) => e.id) })).ok, false);
    await db.event.update({ where: { id: events[1].id }, data: { status: "SCHEDULED" } });
  });
  await check("способ передвижения влияет на допустимость маршрута", async () => {
    const far = await db.venue.create({ data: { name: "Дальняя тестовая площадка", city: "Уфа", lat: 54.73, lon: 56.10 } });
    const distant = await db.event.create({ data: { title: "Дальнее событие", startsAt: at("12:00"), endsAt: at("13:00"), venueId: far.id, priceMin: 100, ageLimit: 0, dedupKey: "visitor-distant" } });
    const conditions = { ...input, count: 2, keep: [events[0].id, distant.id], maxTravelMin: 40 };
    assert.equal((await planDay({ ...conditions, transport: "car" })).ok, true);
    assert.equal((await planDay({ ...conditions, transport: "walk" })).ok, false);
  });
  await check("календарь экранирует строки и переносит длинные названия по границам UTF-8", () => {
    const body = calendar([{ id: "test", title: "Длинное кириллическое название; ".repeat(6) + "\nBEGIN:BAD", start: at("10:00"), end: at("11:00"), location: "Место, зал", url: "https://example.org/event" }]);
    assert.ok(!body.includes("\r\nBEGIN:BAD"));
    assert.ok(body.includes("\\nBEGIN:BAD"));
    assert.ok(body.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75));
    assert.equal((body.match(/BEGIN:VEVENT/g) ?? []).length, 1);
  });
  const watched = events[0];
  await check("открытие бота из избранного запрашивает подтверждение, повторное согласие не дублирует подписку", async () => {
    const before = await db.eventWatch.count();
    const reply = await botAnswer("telegram", "visitor-check", `/start watch_${watched.id}`);
    assert.ok(reply.buttons?.some((row) => row.some((b) => "command" in b && b.command === `/watch ${watched.id} yes`)));
    assert.equal(await db.eventWatch.count(), before);
    await botAnswer("telegram", "visitor-check", `/watch ${watched.id} yes`);
    await botAnswer("telegram", "visitor-check", `/watch ${watched.id} yes`);
    assert.equal(await db.eventWatch.count(), before + 1);
  });
  await check("уведомление после сбоя повторяется, после успеха не дублируется", async () => {
    await db.event.update({ where: { id: watched.id }, data: { priceMin: 120, priceMax: 120 } });
    assert.equal(await sendEventWatchUpdates(async () => false), 0);
    const sent: string[] = [];
    assert.equal(await sendEventWatchUpdates(async (_p, _id, text) => { sent.push(text); return true; }), 1);
    assert.ok(sent[0].includes("цена")); assert.ok(sent[0].includes("120"));
    assert.equal(await sendEventWatchUpdates(async () => { throw new Error("Повторная отправка"); }), 0);
  });
  await check("изменение адреса замечается без изменения самой карточки события", async () => {
    await db.venue.update({ where: { id: venue.id }, data: { address: "Новый тестовый адрес, 2" } });
    const sent: string[] = []; await sendEventWatchUpdates(async (_p, _id, text) => { sent.push(text); return true; });
    assert.equal(sent.length, 1); assert.ok(sent[0].includes("адрес"));
  });
  await check("снятие с публикации не раскрывает изменённое содержимое черновика", async () => {
    await db.event.update({ where: { id: watched.id }, data: { publication: "DRAFT", title: "Закрытое содержание" } });
    const sent: string[] = []; await sendEventWatchUpdates(async (_p, _id, text) => { sent.push(text); return true; });
    assert.equal(sent.length, 1); assert.ok(!sent[0].includes("Закрытое содержание"));
    const watch = await db.eventWatch.findFirstOrThrow({ where: { eventId: watched.id } }); assert.deepEqual(watch.lastState, { publication: "DRAFT" });
    await db.event.update({ where: { id: watched.id }, data: { publication: "PUBLISHED", title: watched.title } });
  });
  await check("отписка удаляет только собственную подписку", async () => {
    const other = await db.botUser.create({ data: { platform: "test", externalId: "another-visitor" } });
    await subscribeToEvent(other.id, watched.id);
    await botAnswer("telegram", "visitor-check", `/unwatch ${watched.id}`);
    assert.equal(await db.eventWatch.count({ where: { botUserId: other.id, eventId: watched.id } }), 1);
    await db.eventWatch.deleteMany();
  });
  await check("MAX запрашивает согласие на подписку и позволяет удалить её одной командой", async () => {
    const before = await db.eventWatch.count();
    const reply = await botAnswer("max", "max-visitor-check", `/start watch_${watched.id}`);
    assert.ok(reply.buttons?.some((row) => row.some((b) => "command" in b && b.command === `/watch ${watched.id} yes`)));
    assert.equal(await db.eventWatch.count(), before);
    await botAnswer("max", "max-visitor-check", `/watch ${watched.id} yes`);
    assert.equal(await db.eventWatch.count(), before + 1);
    await botAnswer("max", "max-visitor-check", "/unsubscribe");
    assert.equal(await db.eventWatch.count(), before);
  });
  await check("старые подписки очищаются и для отменённых событий, текущая выставка сохраняется", async () => {
    const user = await db.botUser.findFirstOrThrow({ where: { externalId: "another-visitor" } });
    const old = new Date(Date.now() - 40 * 86_400_000);
    const cancelled = await db.event.create({ data: { title: "Давно отменено", startsAt: old, status: "CANCELLED", dedupKey: "visitor-old-cancelled" } });
    const exhibition = await db.event.create({ data: { title: "Продолжающаяся выставка", startsAt: old, endsAt: at("18:00"), dedupKey: "visitor-long-exhibition" } });
    for (const e of [cancelled, exhibition]) await db.eventWatch.create({ data: { botUserId: user.id, eventId: e.id, lastState: {} } });
    await purgeOldData();
    assert.equal(await db.eventWatch.count({ where: { eventId: cancelled.id } }), 0);
    assert.equal(await db.eventWatch.count({ where: { eventId: exhibition.id } }), 1);
    await db.eventWatch.deleteMany();
    await db.event.deleteMany({ where: { id: { in: [cancelled.id, exhibition.id] } } });
  });
  const draft = await db.event.create({ data: { title: "Неопубликованная программа", startsAt: at("18:00"), publication: "DRAFT", dedupKey: "visitor-private" } });
  return { date, events, draftId: draft.id, input, mainIds: events.slice(0, 3).map((e) => e.id) };
}
