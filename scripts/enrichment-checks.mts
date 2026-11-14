import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { eventDetails } from "../lib/server/collect/details.ts";
import { jsonLdEvents } from "../lib/server/collect/jsonld.ts";
import { cachedPage, type PageCache } from "../lib/server/collect/fetch.ts";
import { enrichSourceEvents, enrichmentPass, ENRICHMENT_PAGES } from "../lib/server/collect/enrichment.ts";
import { runSource } from "../lib/server/collect/index.ts";
import { contentHash, RECHECK_MS } from "../lib/server/collect/recheck.ts";

type Check = (name: string, fn: () => unknown | Promise<unknown>) => Promise<void>;
export async function enrichmentChecks(db: PrismaClient, check: Check) {
  const startsAt = new Date(Date.now() + 60 * 86_400_000), title = "Проверка дополнения";
  const target = { title, startsAt };
  const html = (text: string, name = title) => `<main><h1>${name}</h1>${text}</main><footer>Бесплатная парковка. 18+</footer>`;
  const ld = (extra: object) => `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicEvent", name: title, startDate: startsAt.toISOString(), ...extra })}</script>`;
  await check("дополнение читает явные возраст и рублёвую цену, сохраняет неизвестный верхний предел", () => {
    const details = eventDetails(html("<p>Возрастное ограничение: 16+</p><p>Стоимость билета: от 1 200 ₽</p>"), target);
    assert.equal(details.age?.value, 16); assert.deepEqual(details.price?.value, { min: 1200, max: null });
    assert.deepEqual(eventDetails(html("<p>Цена билета: 300–800 руб.</p>"), target).price?.value, { min: 300, max: 800 });
    assert.equal(eventDetails(html("<p>Вход свободный</p><p>0+</p>"), target).price?.value.min, 0);
  });
  await check("дополнение исключает чужие карточки, рекомендации, рекламное бесплатно и неоднозначный возраст", () => {
    assert.equal(eventDetails(html("<p>16+</p><p>Цена: 500 ₽</p>", "Другое событие"), target).matched, false);
    const details = eventDetails(html("<p>Детский спектакль</p><p>Бесплатная парковка</p><h2>Вам также понравится</h2><p>18+</p><p>500 ₽</p>"), target);
    assert.equal(details.age, undefined); assert.equal(details.price, undefined);
    assert.equal(eventDetails(html("<p>6+ и 16+</p>"), target).age, undefined);
    assert.equal(eventDetails(html("<p>от 300 ₽</p><p>от 700 ₽</p>"), target).price, undefined);
  });
  await check("JSON-LD учитывает все предложения и валюту, не превращает рекомендуемый возраст в ограничение", () => {
    const markup = ld({ typicalAgeRange: "6-12", offers: [{ price: 800, priceCurrency: "RUB" }, { price: 300, priceCurrency: "RUB" }] });
    assert.deepEqual(eventDetails(markup, target).price?.value, { min: 300, max: 800 });
    assert.equal(eventDetails(markup, target).age, undefined);
    const rows = jsonLdEvents(markup, "https://example.org/event"); assert.equal(rows[0].priceMin, 300); assert.equal(rows[0].priceMax, 800);
    assert.equal(eventDetails(ld({ offers: { price: 10, priceCurrency: "USD" } }), target).price, undefined);
    assert.equal(jsonLdEvents(ld({ offers: { price: 10, priceCurrency: "USD" } }), "https://example.org/event")[0].priceMin, undefined);
    assert.equal(eventDetails(ld({ offers: { price: 500 } }), target).price, undefined);
    assert.equal(eventDetails(ld({ startDate: new Date(startsAt.getTime() + 1000).toISOString(), offers: { price: 500, priceCurrency: "RUB" } }), target).matched, false);
  });
  const bodies = new Map<string, string>(), requests = new Map<string, number>();
  let feed: object[] = [];
  const server = createServer((req, res) => {
    const path = req.url!; requests.set(path, (requests.get(path) ?? 0) + 1);
    if (path === "/feed") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(feed)); }
    if (path === "/failure") { res.statusCode = 503; return res.end("Unavailable"); }
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(bodies.get(path) ?? "No matching event");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No port");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const venue = await db.venue.create({ data: { name: "Площадка дополнения", city: "Уфа", address: "Проверенный адрес, 1", lat: 54.73, lon: 55.95, locationLocked: true } });
    const source = await db.source.create({ data: { code: "enrichment-fixture", name: "Проверка дополнения", kind: "universal_json", url: `${base}/feed`, city: "Уфа", autoPublish: true } });
    const event = await db.event.create({ data: { title, normalizedTitle: title.toLowerCase(), startsAt, venueId: venue.id, dedupKey: "enrichment-fixture", sources: { create: { source: source.code, url: `${base}/event` } } } });
    bodies.set("/event", html("<p>12+</p><p>от 500 ₽</p>"));
    await check("обычный обход сам дополняет опубликованное событие без расписания и ИИ, пишет доказательства", async () => {
      const result = await runSource(source.id, "test"); assert.equal(result.tokens, 0);
      const current = await db.event.findUniqueOrThrow({ where: { id: event.id } });
      assert.equal(current.priceMin, 500); assert.equal(current.priceMax, null); assert.equal(current.ageLimit, 12); assert.equal(current.publication, "PUBLISHED");
      const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: event.id, action: "enrich" } });
      assert.ok((audit.diff as Record<string, unknown>).evidence);
      assert.equal(await db.dataChange.count({ where: { entityId: event.id } }), 0);
      assert.equal(requests.get("/event"), 1, "дополнение и повторная проверка используют одну загрузку");
      assert.ok(result.message.includes("дополнение:"));
      await runSource(source.id, "test"); assert.equal(requests.get("/event"), 1);
    });
    await check("известная цена сохраняется, противоречие уходит в модерацию, пропущенный возраст дополняется", async () => {
      await db.event.update({ where: { id: event.id }, data: { ageLimit: null } });
      bodies.set("/event", html("<p>16+</p><p>от 700 ₽</p>"));
      await db.sourceItem.updateMany({ where: { sourceId: source.id }, data: { checkedAt: new Date(0) } });
      await runSource(source.id, "test");
      const current = await db.event.findUniqueOrThrow({ where: { id: event.id } }); assert.equal(current.priceMin, 500); assert.equal(current.ageLimit, 16);
      const change = await db.dataChange.findFirstOrThrow({ where: { entityId: event.id, status: "pending" } }); assert.equal((change.after as Record<string, unknown>).priceMin, 700);
    });
    await check("отклонённые сведения и поля, очищенные человеком, не восстанавливаются автоматически", async () => {
      await db.event.update({ where: { id: event.id }, data: { ageLimit: null, priceMin: null } });
      await db.auditLog.create({ data: { entity: "event", entityId: event.id, action: "update", userLogin: "moderator", summary: "Очистил возраст", diff: { ageLimit: [16, null] } } });
      await db.dataChange.updateMany({ where: { entityId: event.id }, data: { status: "rejected" } });
      bodies.set("/event", html("<p>18+</p><p>от 700 ₽</p><!--changed-->"));
      await db.sourceItem.updateMany({ where: { sourceId: source.id }, data: { checkedAt: new Date(0) } });
      await enrichSourceEvents(source, new Map(), enrichmentPass(), "test");
      const current = await db.event.findUniqueOrThrow({ where: { id: event.id } }); assert.equal(current.ageLimit, null); assert.equal(current.priceMin, null);
    });
    await check("новая карточка дополняется в том же обходе, повторная ссылка не создаёт второй сеанс", async () => {
      const newTitle = "Новое событие дополнения";
      bodies.set("/new", html("<p>6+</p><p>Вход свободный</p>", newTitle));
      feed = [{ title: newTitle, dateStart: new Date(startsAt.getTime() + 86400000).toISOString(), city: "Уфа", venue: venue.name, category: "concert", sourceUrl: `${base}/new` }];
      await runSource(source.id, "test");
      const e = await db.event.findFirstOrThrow({ where: { title: newTitle } }); assert.equal(e.priceMin, 0); assert.equal(e.ageLimit, 6);
      assert.equal(e.publication, "DRAFT", "дополнение не обходит модерацию новой неполной карточки");
      await runSource(source.id, "test"); assert.equal(await db.event.count({ where: { title: newTitle } }), 1);
      feed = [];
    });
    await check("подтверждённый адрес защищён, адрес другой площадки не переносится", async () => {
      const markup = ld({ location: { name: venue.name, address: { addressLocality: venue.city, streetAddress: "Другой адрес, 9" } } });
      bodies.set("/event", markup); await db.sourceItem.updateMany({ where: { sourceId: source.id }, data: { checkedAt: new Date(0) } });
      await enrichSourceEvents(source, new Map(), enrichmentPass(), "test");
      assert.equal((await db.venue.findUniqueOrThrow({ where: { id: venue.id } })).address, venue.address);
      assert.equal(await db.dataChange.count({ where: { entity: "venue", entityId: venue.id, status: "pending" } }), 1);
      const other = await db.venue.create({ data: { name: "Площадка без адреса", city: "Уфа" } });
      const separate = await db.event.create({ data: { title: "Другое мероприятие", startsAt, venueId: other.id, dedupKey: "enrich-wrong-venue", sources: { create: { source: source.code, url: `${base}/wrong-venue` } } } });
      bodies.set("/wrong-venue", ld({ name: separate.title, location: { name: venue.name, address: { addressLocality: venue.city, streetAddress: venue.address } } }));
      await enrichSourceEvents(source, new Map(), enrichmentPass(), "test", [separate.id]);
      assert.equal((await db.venue.findUniqueOrThrow({ where: { id: other.id } })).address, null);
      bodies.set("/wrong-venue", ld({ name: separate.title, location: { name: other.name, address: { addressLocality: venue.city, streetAddress: "Новый адрес, 2" }, geo: { latitude: 54.74, longitude: 55.96 } } }));
      await enrichSourceEvents(source, new Map(), enrichmentPass(), "test", [separate.id]);
      const filled = await db.venue.findUniqueOrThrow({ where: { id: other.id } }); assert.equal(filled.address, "Новый адрес, 2"); assert.equal(filled.lat, 54.74);
    });
    await check("сбой страницы не блокирует дополнение остальных и получает время следующей проверки", async () => {
      const e = await db.event.create({ data: { title: "Сбой дополнения", startsAt, venueId: venue.id, dedupKey: "enrich-error", sources: { create: { source: source.code, url: `${base}/failure` } } } });
      const pass = enrichmentPass(); await enrichSourceEvents(source, new Map(), pass, "test", [e.id]); assert.equal(pass.errors, 1);
      const record = await db.sourceItem.findUniqueOrThrow({ where: { sourceId_guid: { sourceId: source.id, guid: `enrich:v1:${contentHash(`${base}/failure`)}` } } });
      assert.equal(record.status, "error"); assert.ok(record.checkedAt);
      const before = requests.get("/failure"); await enrichSourceEvents(source, new Map(), enrichmentPass(), "test"); assert.equal(requests.get("/failure"), before);
    });
    await check("обход ограничен десятью страницами, недавно проверенные не вытесняют остальные", async () => {
      for (let i = 0; i < 12; i++) {
        const name = `Очередь дополнения ${i}`; bodies.set(`/queue-${i}`, html("<p>0+</p><p>Вход свободный</p>", name));
        await db.event.create({ data: { title: name, startsAt, venueId: venue.id, dedupKey: `enrich-queue-${i}`, sources: { create: { source: source.code, url: `${base}/queue-${i}` } } } });
      }
      const pass = enrichmentPass(); await enrichSourceEvents(source, new Map(), pass, "test"); assert.equal(pass.urls.size, ENRICHMENT_PAGES);
      await enrichSourceEvents(source, new Map(), enrichmentPass(), "test");
      assert.equal(await db.event.count({ where: { dedupKey: { startsWith: "enrich-queue-" }, ageLimit: 0, priceMin: 0 } }), 12);
      assert.equal(await db.sourceItem.count({ where: { sourceId: source.id, link: { startsWith: `${base}/queue-` }, guid: { startsWith: "enrich:v1:" }, checkedAt: { lt: new Date(Date.now() - RECHECK_MS) } } }), 0);
      const pages: PageCache = new Map(); const before = requests.get("/queue-0")!;
      await Promise.all([cachedPage(pages, `${base}/queue-0`), cachedPage(pages, `${base}/queue-0`)]); assert.equal(requests.get("/queue-0"), before + 1);
    });
  } finally { server.close(); await once(server, "close"); }
}
