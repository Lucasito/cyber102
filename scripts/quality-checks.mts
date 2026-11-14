import assert from "node:assert/strict";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { qualityReport } from "../lib/server/quality.ts";

export async function qualityChecks(db: PrismaClient, check: (name: string, fn: () => unknown | Promise<unknown>) => Promise<void>) {
  const now = new Date(), day = 86_400_000;
  const city = "Проверочный город качества";
  const venue = await db.venue.create({ data: { name: "Точная площадка", city, address: "Тестовый адрес, 1", lat: 54.73, lon: 55.95 } });
  const unknownVenue = await db.venue.create({ data: { name: "Неточное место", city, address: " ", approx: true } });
  let seq = 0;
  const create = (title: string, extra: object = {}, source = "quality-fixture") => db.event.create({ data: {
    title, startsAt: new Date(now.getTime() + ++seq * day), ageLimit: 0, priceMin: 0, venueId: venue.id, dedupKey: `quality-${seq}`,
    sources: { create: { source, url: `https://example.org/quality/${seq}`, fetchedAt: new Date(now.getTime() - day) } }, ...extra,
  } });
  const complete = await create("Полная бесплатная карточка");
  const price = await create("Неизвестная цена", { priceMin: null });
  await create("Неизвестный возраст", { ageLimit: null });
  await create("Неточный адрес", { venueId: unknownVenue.id });
  const noSource = await create("Нет источника"); await db.eventSource.deleteMany({ where: { eventId: noSource.id } });
  const source = await db.source.create({ data: { code: "quality-failed-source", name: "Проверка ошибки источника", kind: "universal_json", url: "https://example.org/feed", enabled: false, lastStatus: "error", lastRunAt: now } });
  const failed = await create("Ошибка источника", {}, source.code);
  const ongoing = await create("Идёт сейчас", { startsAt: new Date(now.getTime() - 2 * day), endsAt: new Date(now.getTime() + day), priceMin: null });
  await create("Дальний неполный анонс", { startsAt: new Date(now.getTime() + 40 * day), priceMin: null });
  await create("Закрытый черновик качества", { publication: "DRAFT", priceMin: null });
  await create("Давно прошедшее", { startsAt: new Date(now.getTime() - day), priceMin: null });
  await create("Отменённое", { status: "CANCELLED", priceMin: null });
  const options = { q: city };
  await check("качество считает каждую карточку один раз, бесплатные и 0+ заполнены", async () => {
    const report = await qualityReport(options, now);
    assert.deepEqual(report.counts, { total: 7, affected: 6, price: 2, age: 1, address: 1, source: 2 });
    assert.equal(report.items[0].id, ongoing.id);
    assert.equal(report.items[1].id, price.id);
    assert.ok(!report.items.some((e) => e.id === complete.id));
  });
  await check("фильтры качества сохраняют область поиска и исключают закрытые карточки по умолчанию", async () => {
    const prices = await qualityReport({ ...options, issue: "price" }, now);
    assert.deepEqual(prices.items.map((e) => e.id), [ongoing.id, price.id]);
    assert.equal((await qualityReport({ ...options, publication: "draft" }, now)).total, 1);
    assert.equal((await qualityReport({ ...options, days: "all" }, now)).counts.affected, 7);
    assert.equal((await qualityReport({ q: "%" }, now)).counts.total, 0);
    assert.equal((await qualityReport({ q: "' OR 1=1 --" }, now)).counts.total, 0);
  });
  await check("ошибка источника отделена от отсутствующей ссылки и не перекрывает более свежую проверку", async () => {
    const report = await qualityReport({ ...options, issue: "source" }, now);
    assert.equal(report.items.find((e) => e.id === failed.id)?.sourceError, true);
    assert.equal(report.items.find((e) => e.id === failed.id)?.missingSource, false);
    assert.equal(report.items.find((e) => e.id === noSource.id)?.missingSource, true);
    await db.source.update({ where: { id: source.id }, data: { lastStatus: "ok" } });
    await db.sourceItem.create({ data: { sourceId: source.id, guid: "quality-detail", eventId: failed.id, status: "error", checkedAt: now } });
    assert.equal((await qualityReport({ ...options, issue: "source" }, now)).total, 2);
    await db.eventSource.updateMany({ where: { eventId: failed.id }, data: { fetchedAt: new Date(now.getTime() + 1000) } });
    assert.equal((await qualityReport({ ...options, issue: "source" }, now)).total, 1);
    await db.source.update({ where: { id: source.id }, data: { lastStatus: "error", lastRunAt: new Date(now.getTime() + 2000) } });
  });
  await check("очередь качества листается без пропусков, неверная страница ограничивается последней", async () => {
    await db.event.createMany({ data: Array.from({ length: 31 }, (_, i) => ({ title: `Проверка страниц качества ${i}`, dedupKey: `quality-page-${i}`, venueId: venue.id, startsAt: new Date(now.getTime() + (12 + i / 100) * day) })) });
    const a = await qualityReport(options, now), b = await qualityReport({ ...options, page: "999999" }, now);
    assert.equal(a.items.length, 30); assert.equal(b.page, 2); assert.equal(b.items.length, 7);
    assert.equal(new Set([...a.items, ...b.items].map((e) => e.id)).size, 37);
    await db.event.deleteMany({ where: { dedupKey: { startsWith: "quality-page-" } } });
  });
  return { q: city, firstId: ongoing.id, draftTitle: "Закрытый черновик качества" };
}
