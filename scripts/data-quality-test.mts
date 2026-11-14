// Интеграционные проверки на отдельной временной локальной PostgreSQL-базе. Продакшн не используется.
import "dotenv/config";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createTcpServer } from "node:net";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { readFile } from "node:fs/promises";

const base = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw new Error("Проверки разрешены только на локальном PostgreSQL.");
const database = `afisha_quality_test_${Date.now()}`;
const admin = new Client({ connectionString: base.toString() });
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
base.pathname = `/${database}`;
process.env.DATABASE_URL = base.toString();
process.env.AI_PROVIDER = "none";
let disconnect: (() => Promise<void>) | undefined;
const server = createServer();
let passed = 0;
try {
  const migration = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"], { env: process.env, encoding: "utf8" });
  if (migration.status !== 0) throw new Error(migration.stderr || migration.stdout);
  const { db } = await import("../lib/server/db.ts");
  disconnect = () => db.$disconnect();
  const { addVenueAlias, resolveVenue, importVenueLocation, mergeVenues } = await import("../lib/server/venue-registry.ts");
  const { queueDataChange, reviewDataChange } = await import("../lib/server/data-changes.ts");
  const { importRows } = await import("../lib/server/import.ts");
  const { runSource } = await import("../lib/server/collect/index.ts");
  const { applySourceVenue } = await import("../lib/server/collect/venue.ts");
  const { shouldRecheck, RECHECK_MS } = await import("../lib/server/collect/recheck.ts");
  const { dedupKey } = await import("../lib/server/normalize.ts");
  const check = async (name: string, fn: () => unknown | Promise<unknown>) => { await fn(); passed++; console.log(`OK ${passed}: ${name}`); };
  await check("миграция сохраняет исправленные города и варианты ранее объединённых площадок", async () => {
    const fixture = new Client({ connectionString: process.env.DATABASE_URL }); await fixture.connect();
    try {
      await fixture.query('BEGIN; CREATE SCHEMA migration_fixture; SET LOCAL search_path TO migration_fixture; CREATE TABLE "Venue" (id TEXT PRIMARY KEY,name TEXT,city TEXT,address TEXT,lat FLOAT,lon FLOAT,approx BOOLEAN); CREATE TABLE "AuditLog" (id TEXT PRIMARY KEY,entity TEXT,"entityId" TEXT,action TEXT,summary TEXT,diff JSONB,"createdAt" TIMESTAMP DEFAULT NOW()); CREATE TABLE "SourceItem" (id TEXT);');
      await fixture.query('INSERT INTO "Venue" VALUES ($1,$2,$3,$4,53.36,55.92,false),($5,$6,$7,$8,54.73,55.95,false)', ["salavat", "ЦДТ «Нефтехимик»", "Салават", "ул. Гагарина, 2А", "city-fixed", "Городской центр культуры Нефтекамска", "Нефтекамск", "Юбилейный проспект, 17"]);
      await fixture.query('INSERT INTO "AuditLog" (id,entity,"entityId",action,summary,diff) VALUES ($1,\'venue\',$2,\'merge\',\'merge\',$3),($4,\'venue\',$5,\'update\',\'update\',$6)', ["merge-log", "old-removed", JSON.stringify({ record: [{ name: "ЦДТ «Нефтехимик»", city: "Уфа" }, null], mergedInto: [null, "salavat"] }), "city-log", "city-fixed", JSON.stringify({ city: ["Уфа", "Нефтекамск"] })]);
      await fixture.query(await readFile(new URL("../prisma/migrations/20261114140000_data_quality/migration.sql", import.meta.url), "utf8"));
      const aliases = (await fixture.query('SELECT key,"cityKey","venueId" FROM "VenueAlias" WHERE "cityKey"=\'уфа\'')).rows;
      assert.equal(aliases.length, 2); assert.ok(aliases.some((a) => a.key === "цдт нефтехимик" && a.venueId === "salavat"));
      assert.equal((await fixture.query('SELECT "locationLocked" FROM "Venue" WHERE id=\'salavat\'')).rows[0].locationLocked, true);
    } finally { await fixture.query("ROLLBACK"); await fixture.end(); }
  });
  await db.category.create({ data: { slug: "concert", name: "Концерт" } });
  const protectedVenue = await db.venue.create({ data: { name: "ЦДТ «Нефтехимик»", city: "Салават", address: "ул. Гагарина, 2А", lat: 53.3617155, lon: 55.9274147, locationLocked: true } });
  await check("защищённый адрес и координаты не меняются при импорте", async () => {
    await db.$transaction((tx) => importVenueLocation(tx, protectedVenue, { address: "Ошибочная улица, 1", lat: 54.7, lon: 55.9 }, "test"));
    const after = await db.venue.findUniqueOrThrow({ where: { id: protectedVenue.id } });
    assert.equal(after.address, protectedVenue.address); assert.equal(after.lat, protectedVenue.lat);
    assert.equal(await db.dataChange.count({ where: { entityId: protectedVenue.id } }), 1);
  });
  await check("повторный конфликт не создаёт второе предложение", async () => {
    await db.$transaction((tx) => importVenueLocation(tx, protectedVenue, { address: "Ошибочная улица, 1", lat: 54.7, lon: 55.9 }, "test"));
    assert.equal(await db.dataChange.count({ where: { entityId: protectedVenue.id } }), 1);
  });
  await check("координаты источника не обходят защиту", async () => {
    await applySourceVenue({ city: "Салават", venueName: protectedVenue.name, venueAddress: "Другой адрес, 2", venueLat: 54.1, venueLon: 55.8 });
    assert.equal((await db.venue.findUniqueOrThrow({ where: { id: protectedVenue.id } })).lat, protectedVenue.lat);
  });
  await check("вариант названия исправляет город и не создаёт новую площадку", async () => {
    await db.$transaction(async (tx) => {
      await addVenueAlias(tx, protectedVenue.id, "ДК Нефтехимик", "Уфа");
      assert.equal((await resolveVenue(tx, "дк «Нефтехимик»", "Уфа")).id, protectedVenue.id);
    });
    await assert.rejects(db.$transaction((tx) => addVenueAlias(tx, "missing", "ДК Нефтехимик", "Уфа")), /уже связано/);
  });
  await check("зал связан со зданием и наследует защищённое местоположение", async () => {
    await db.$transaction(async (tx) => {
      const h = await resolveVenue(tx, "ДК Нефтехимик, Большой зал", "Уфа");
      assert.equal(h.buildingId, protectedVenue.id); assert.equal(h.city, "Салават");
      assert.equal((await resolveVenue(tx, `${protectedVenue.name}, Большой зал`, "Салават")).id, h.id);
      await importVenueLocation(tx, h, { address: "Неверный адрес, 3", lat: 54.1, lon: 56.1 }, "hall-test");
      assert.equal((await tx.venue.findUniqueOrThrow({ where: { id: h.id } })).lat, protectedVenue.lat);
    });
  });
  await check("разные здания не объединяются по общему слову", async () => {
    const a = await db.$transaction((tx) => resolveVenue(tx, "Городской дом культуры", "Сибай"));
    const b = await db.$transaction((tx) => resolveVenue(tx, "Сибайская филармония", "Сибай"));
    assert.notEqual(a.id, b.id);
  });

  const first = new Date(Date.now() + 7 * 86_400_000); first.setUTCHours(14, 0, 0, 0);
  let startsAt = first.toISOString(), status = "https://schema.org/EventScheduled", feedPresent = true, feedVersion = 1, pageRequests = 0;
  let detailFailure = true, detailFailures = 0;
  server.on("request", (req, res) => {
    if (req.url === "/me" || req.url === "/botfixture/getMe") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(req.url === "/me" ? { user_id: "1", username: "QualityTestBot" } : { ok: true, result: { id: 1, username: "QualityTestBot", first_name: "Test" } }));
    }
    res.setHeader("Content-Type", req.url === "/feed" ? "application/rss+xml; charset=utf-8" : "text/html; charset=utf-8");
    if (req.url === "/feed") return res.end(`<rss version="2.0"><channel>${feedPresent ? `<item><guid>stable-guid</guid><title>Концерт тестового оркестра</title><link>${url}/event</link><description>Версия ${feedVersion}</description></item>` : ""}</channel></rss>`);
    if (req.url === "/empty") { res.setHeader("Content-Type", "application/json"); return res.end("[]"); }
    const detail = req.url?.match(/^\/detail(\d+)$/);
    if (detail?.[1] === "0" && detailFailure) { detailFailures++; res.statusCode = 503; return res.end("Unavailable"); }
    pageRequests++;
    const event = { "@type": "MusicEvent", name: "Концерт тестового оркестра", description: "Программа оркестра", startDate: startsAt, eventStatus: status, url: `${url}/event`, location: { name: protectedVenue.name, address: { streetAddress: protectedVenue.address, addressLocality: protectedVenue.city } }, offers: { price: 500 } };
    if (detail) { event.name = `Детальная программа ${detail[1]}`; event.startDate = new Date(first.getTime() + Number(detail[1]) * 86_400_000).toISOString(); event.eventStatus = "https://schema.org/EventCancelled"; }
    res.end(`<html><body>Постоянный текст страницы<script type="application/ld+json">${JSON.stringify(event)}</script></body></html>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Нет локального порта");
  const url = `http://127.0.0.1:${address.port}`;
  const source = await db.source.create({ data: { code: "fixture", name: "Тестовая RSS", kind: "rss_ai", url: `${url}/feed`, city: "Уфа" } });
  const due = () => db.sourceItem.updateMany({ where: { sourceId: source.id }, data: { checkedAt: new Date(Date.now() - RECHECK_MS - 1000) } });
  await runSource(source.id, "test");
  const original = await db.event.findFirstOrThrow({ where: { sources: { some: { source: source.code } } } });
  await db.event.update({ where: { id: original.id }, data: { publication: "PUBLISHED", needsReview: false } });
  await check("недавняя неизменённая запись не загружает страницу повторно", async () => {
    const requests = pageRequests; await runSource(source.id, "test"); assert.equal(pageRequests, requests);
  });
  await check("изменение только JSON-LD при прежнем GUID обнаруживается", async () => {
    startsAt = new Date(first.getTime() + 86_400_000).toISOString(); await due(); await runSource(source.id, "test");
    assert.equal(await db.event.count({ where: { title: original.title } }), 1);
    assert.equal((await db.event.findUniqueOrThrow({ where: { id: original.id } })).startsAt.toISOString(), first.toISOString());
    const proposal = await db.dataChange.findFirstOrThrow({ where: { entity: "event", entityId: original.id, status: "pending" } });
    assert.equal((proposal.after as Record<string, unknown>).startsAt, startsAt);
    await reviewDataChange(proposal.id, true, "test");
    const moved = await db.event.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(moved.status, "RESCHEDULED"); assert.equal(moved.startsAt.toISOString(), startsAt); assert.equal(moved.originalStartsAt?.toISOString(), first.toISOString());
    assert.equal(moved.dedupKey, dedupKey(moved.title, moved.startsAt, protectedVenue.name, protectedVenue.city));
  });
  await check("изменение ленты проверяется сразу, без ожидания суток", async () => {
    assert.equal(shouldRecheck({ feedHash: "old", checkedAt: new Date() }, "new", true), true);
    status = "https://schema.org/EventCancelled"; feedVersion++; await runSource(source.id, "test");
    const proposal = await db.dataChange.findFirstOrThrow({ where: { entityId: original.id, status: "pending" } });
    assert.equal((proposal.after as Record<string, unknown>).status, "CANCELLED");
    await reviewDataChange(proposal.id, false, "test");
    assert.equal((await db.event.findUniqueOrThrow({ where: { id: original.id } })).status, "RESCHEDULED");
    await due(); await runSource(source.id, "test");
    assert.equal(await db.dataChange.count({ where: { entityId: original.id, status: "pending" } }), 0);
  });
  await check("будущее событие проверяется после исчезновения из RSS", async () => {
    feedPresent = false; status = "https://schema.org/EventScheduled"; startsAt = new Date(first.getTime() + 2 * 86_400_000).toISOString();
    await due(); await runSource(source.id, "test");
    assert.ok(await db.dataChange.findFirst({ where: { entityId: original.id, status: "pending" } }));
  });
  await check("устаревшее предложение не затирает ручное исправление", async () => {
    const current = await db.event.findUniqueOrThrow({ where: { id: original.id } });
    const p = await db.$transaction((tx) => queueDataChange(tx, { entity: "event", entityId: original.id, source: "stale", current, proposed: { priceMin: 600 } }));
    await db.event.update({ where: { id: original.id }, data: { priceMin: 550, priceMax: null } });
    await assert.rejects(reviewDataChange(p!.id, true, "test"), /уже изменена/);
    assert.equal((await db.event.findUniqueOrThrow({ where: { id: original.id } })).priceMin, 550);
    await reviewDataChange(p!.id, false, "test");
  });
  await check("подтверждённая отмена меняет статус и ставит ожидающее напоминание в очередь", async () => {
    const current = await db.event.findUniqueOrThrow({ where: { id: original.id } });
    const bot = await db.botUser.create({ data: { platform: "test", externalId: "cancellation" } });
    const reminder = await db.reminder.create({ data: { eventId: current.id, botUserId: bot.id, remindAt: first } });
    const p = await db.$transaction((tx) => queueDataChange(tx, { entity: "event", entityId: current.id, source: "cancel-test", current, proposed: { status: "CANCELLED" } }));
    await reviewDataChange(p!.id, true, "test");
    assert.equal((await db.event.findUniqueOrThrow({ where: { id: current.id } })).status, "CANCELLED");
    assert.ok((await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).remindAt.getTime() <= Date.now());
  });
  await check("импорт по варианту имени использует каноническую площадку и ключ", async () => {
    const row = { title: "Отдельный концерт", dateStart: startsAt, city: "Уфа", venue: "ДК Нефтехимик", price: 100, category: "concert", sourceUrl: `${url}/alias` };
    const report = await importRows([row], { fileName: "test", source: "alias-test", userLogin: "test" });
    assert.equal(report.created, 1);
    const e = await db.event.findUniqueOrThrow({ where: { id: report.rows[0].eventId! } });
    assert.equal(e.venueId, protectedVenue.id); assert.equal(e.dedupKey, dedupKey(e.title, e.startsAt, protectedVenue.name, protectedVenue.city));
  });
  await check("сбой детальной страницы не отменяет событие и не блокирует остальные проверки", async () => {
    const details = await db.source.create({ data: { code: "details", name: "Детальные страницы", kind: "universal_json", url: `${url}/empty`, autoPublish: true, city: "Салават" } });
    for (let i = 0; i < 6; i++) {
      const title = `Детальная программа ${i}`, date = new Date(first.getTime() + i * 86_400_000);
      await db.event.create({ data: { title, normalizedTitle: title.toLowerCase(), startsAt: date, venueId: protectedVenue.id, dedupKey: dedupKey(title, date, protectedVenue.name, protectedVenue.city),
        sources: { create: { source: details.code, url: `${url}/detail${i}` } } } });
    }
    await runSource(details.id, "test");
    assert.equal(await db.dataChange.count({ where: { source: details.code } }), 4);
    const failures = detailFailures;
    await runSource(details.id, "test");
    assert.equal(await db.dataChange.count({ where: { source: details.code } }), 5); assert.equal(detailFailures, failures);
    const failed = await db.event.findFirstOrThrow({ where: { title: "Детальная программа 0" } }); assert.equal(failed.status, "SCHEDULED");
    detailFailure = false; await db.sourceItem.updateMany({ where: { sourceId: details.id, status: "error" }, data: { checkedAt: new Date(0) } });
    await runSource(details.id, "test");
    assert.equal(await db.dataChange.count({ where: { source: details.code } }), 6);
  });
  await check("сеансы одного фильма в двух кинотеатрах сети не склеиваются и не считаются дублями", async () => {
    await db.category.upsert({ where: { slug: "cinema" }, create: { slug: "cinema", name: "Кино" }, update: {} });
    const film = { title: "Проверочный фильм", city: "Уфа", price: 300, category: "cinema", sourceUrl: `${url}/kino` };
    const a = await importRows([{ ...film, dateStart: first.toISOString(), venue: "Синема Парк, ТРК «Семья»", externalId: "a:1" }], { fileName: "test", source: "kino-a", userLogin: "test" });
    const b = await importRows([{ ...film, dateStart: new Date(first.getTime() + 10 * 60_000).toISOString(), venue: "Синема Парк, ТРЦ «Галерея Арт»", externalId: "b:1" }], { fileName: "test", source: "kino-b", userLogin: "test" });
    assert.equal(a.created + b.created, 2);
    const events = await db.event.findMany({ where: { title: film.title } });
    assert.equal(events.length, 2);
    assert.ok(events.every((e) => !/дубль/.test(e.reviewNote ?? "")), events.map((e) => e.reviewNote).join(" / "));
  });
  await check("один внешний идентификатор на странице не склеивает разные сеансы", async () => {
    const row = { title: "Несколько сеансов", dateStart: first.toISOString(), city: "Салават", venue: protectedVenue.name, price: 100, category: "concert", sourceUrl: `${url}/sessions`, externalId: "shared-id" };
    const rows = [row, { ...row, dateStart: new Date(first.getTime() + 4 * 3_600_000).toISOString() }];
    const report = await importRows(rows, { fileName: "test", source: "sessions-test", userLogin: "test" });
    assert.equal(report.created, 2); assert.equal(await db.event.count({ where: { title: row.title } }), 2);
    const again = await importRows(rows, { fileName: "test", source: "sessions-test", userLogin: "test", verifyLinks: true });
    assert.equal(again.created, 0); assert.equal(await db.event.count({ where: { title: row.title } }), 2);
  });
  await check("объединение площадок сохраняет источники, напоминания и старые имена", async () => {
    const drop = await db.venue.create({ data: { name: "Нефтехимик, альтернативное название", city: "Уфа" } });
    const title = "Концерт для объединения";
    const keepEvent = await db.event.create({ data: { title, normalizedTitle: title.toLowerCase(), startsAt: first, venueId: protectedVenue.id, dedupKey: dedupKey(title, first, protectedVenue.name, protectedVenue.city), sources: { create: { source: "one", url: `${url}/merge1` } } } });
    const dropEvent = await db.event.create({ data: { title, normalizedTitle: title.toLowerCase(), startsAt: first, venueId: drop.id, dedupKey: dedupKey(title, first, drop.name, drop.city), sources: { create: { source: "two", url: `${url}/merge2` } } } });
    const bot = await db.botUser.create({ data: { platform: "test", externalId: "1" } });
    await db.reminder.create({ data: { botUserId: bot.id, eventId: dropEvent.id, remindAt: first } });
    await db.$transaction((tx) => mergeVenues(tx, protectedVenue.id, drop.id, "test"));
    assert.equal(await db.eventSource.count({ where: { eventId: keepEvent.id } }), 2);
    assert.equal(await db.reminder.count({ where: { eventId: keepEvent.id } }), 1);
    assert.equal(await db.venue.count({ where: { id: drop.id } }), 0);
    assert.equal((await db.$transaction((tx) => resolveVenue(tx, drop.name, drop.city))).id, protectedVenue.id);
  });
  await (await import("./enrichment-checks.mts")).enrichmentChecks(db, check);
  const quality = await (await import("./quality-checks.mts")).qualityChecks(db, check);
  const visitor = await (await import("./visitor-checks.mts")).visitorChecks(db, check);
  if (process.argv.includes("--ui") || process.argv.includes("--browser")) {
    // Обе кнопки ботов видны, но их API подменены локальным сервером, polling выключен.
    await db.setting.createMany({ data: [
      { key: "max", value: { enabled: true, token: "fixture" } },
      { key: "telegram", value: { enabled: true, token: "fixture", mode: "webhook", apiUrl: url } },
    ] });
    const socket = createTcpServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
    const bound = socket.address(); if (!bound || typeof bound === "string") throw new Error("Нет порта приложения");
    const port = bound.port; await new Promise<void>((resolve) => socket.close(() => resolve()));
    const env = { ...process.env, NODE_ENV: "production", PUBLIC_URL: `http://127.0.0.1:${port}`, MAX_MODE: "webhook", MAX_API_URL: url };
    for (const k of Object.keys(env)) if (/^(MAX_BOT_TOKEN|TELEGRAM_|GIGACHAT_|LLM_)/.test(k)) delete env[k as keyof typeof env];
    const app = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)), "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let logs = ""; app.stdout.on("data", (s) => { logs = (logs + String(s)).slice(-5000); }); app.stderr.on("data", (s) => { logs = (logs + String(s)).slice(-5000); });
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      let ready = false;
      for (let i = 0; i < 50; i++) {
        try { ready = (await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* запуск сервера */ }
        if (ready) break; await new Promise((resolve) => setTimeout(resolve, 150));
      }
      assert.ok(ready, logs);
      const moderator = await db.adminUser.create({ data: { login: "test-moderator", role: "MODERATOR", passwordHash: "unused" } });
      const organizer = await db.adminUser.create({ data: { login: "test-organizer", role: "ORGANIZER", passwordHash: "unused" } });
      for (const [token, userId] of [["moderator-test-session", moderator.id], ["organizer-test-session", organizer.id]]) {
        await db.adminSession.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 60_000) } });
      }
      const authenticated = (path: string, token = "moderator-test-session") => fetch(`${baseUrl}${path}`, { headers: { Cookie: `afisha_adm=${token}` }, redirect: "manual" });
      await check("страница справочника показывает защиту, варианты и объединение", async () => {
        const r = await authenticated("/admin/venues"); assert.equal(r.status, 200, logs); const html = await r.text();
        for (const label of ["Защитить адрес", "Варианты названия", "Объединить площадки", "Город в источнике"]) assert.ok(html.includes(label), label);
      });
      await check("модерация показывает таблицу изменений и действия", async () => {
        const r = await authenticated("/admin/moderation"); assert.equal(r.status, 200, logs); const html = await r.text();
        for (const label of ["Изменения источников", "Было", "Стало", "Принять изменение", "Отклонить"]) assert.ok(html.includes(label), label);
      });
      await check("новые страницы недоступны гостю и организатору", async () => {
        const guest = await fetch(`${baseUrl}/admin/venues`, { redirect: "manual" }); assert.equal(guest.status, 307); assert.ok(guest.headers.get("location")?.includes("/admin/login"));
        assert.equal((await authenticated("/admin/venues", "organizer-test-session")).status, 404);
        assert.equal((await fetch(`${baseUrl}/admin/quality`, { redirect: "manual" })).status, 307);
        assert.equal((await authenticated("/admin/quality", "organizer-test-session")).status, 404);
      });
      await check("модератор видит очередь качества с приоритетом ближайших событий и фильтрами", async () => {
        const r = await authenticated(`/admin/quality?q=${encodeURIComponent(quality.q)}`); assert.equal(r.status, 200, logs);
        const html = await r.text();
        for (const label of ["Качество афиши", "Не указана цена", "Не указан возраст", "Место уточняется", "Ошибка проверки источника", "Исправить карточку"]) assert.ok(html.includes(label), label);
        assert.match(html, new RegExp(`data-quality-event="${quality.firstId}"`));
        assert.ok(!html.includes(quality.draftTitle));
        const filtered = await authenticated(`/admin/quality?q=${encodeURIComponent(quality.q)}&issue=age`);
        assert.equal(((await filtered.text()).match(/data-quality-event=/g) ?? []).length, 1);
        assert.equal((await authenticated(`/admin/quality?q=${encodeURIComponent(quality.q)}&q=other`)).status, 200);
      });
      await check("публичный API отдаёт варианты названий и связь с зданием", async () => {
        const r = await fetch(`${baseUrl}/api/v1/venues`); assert.equal(r.status, 200); const body = await r.json();
        const v = body.items.find((v: { id: string }) => v.id === protectedVenue.id);
        assert.ok(v.aliases.some((a: { name: string }) => a.name === "ДК Нефтехимик"));
        assert.ok(body.items.some((v: { buildingId: string }) => v.buildingId === protectedVenue.id));
      });
      await check("избранное загружает только опубликованные события без регистрации пользователя", async () => {
        const users = await db.botUser.count();
        const r = await fetch(`${baseUrl}/api/v1/events/batch?ids=${visitor.events[1].id},${visitor.draftId},missing-id`); assert.equal(r.status, 200);
        const data = await r.json(); assert.equal(data.items.length, 1); assert.deepEqual(data.missing.sort(), [visitor.draftId, "missing-id"].sort());
        assert.equal(await db.botUser.count(), users);
        assert.equal((await fetch(`${baseUrl}/api/v1/events/batch?ids=${Array(101).fill("id").join(",")}`)).status, 400);
      });
      await check("страницы избранного и планировщика доступны гостю", async () => {
        for (const path of ["/favorites", "/plan"]) { const r = await fetch(`${baseUrl}${path}`); assert.equal(r.status, 200); assert.equal(r.headers.get("set-cookie"), null); }
        const r = await fetch(`${baseUrl}/plan?${new URLSearchParams(Object.entries(visitor.input).map(([k, v]) => [k, String(v)]))}`); const html = await r.text();
        assert.equal(r.status, 200); assert.ok(html.includes("Ваш маршрут")); assert.ok(html.includes("Заменить событие"));
      });
      await check("API планировщика и календарь сохраняют выбранные остановки", async () => {
        const params = new URLSearchParams(Object.entries(visitor.input).map(([k, v]) => [k, String(v)])); params.set("keep", visitor.mainIds.join(","));
        const api = await fetch(`${baseUrl}/api/v1/plan?${params}`); const plan = await api.json(); assert.equal(plan.ok, true);
        const r = await fetch(`${baseUrl}/plan/ics?${params}`); assert.equal(r.status, 200); assert.match(r.headers.get("content-type")!, /text\/calendar/);
        assert.equal(((await r.text()).match(/BEGIN:VEVENT/g) ?? []).length, 3);
        assert.equal((await fetch(`${baseUrl}/api/v1/plan?date=2027-02-30`)).status, 400);
      });
      if (process.argv.includes("--browser")) {
        const usersBefore = await db.botUser.count();
        await (await import("./visitor-browser-checks.mts")).visitorBrowserChecks(baseUrl, visitor, check);
        assert.equal(await db.botUser.count(), usersBefore, "Браузерное избранное не должно создавать профиль в базе");
      }
    } finally { app.kill(); await once(app, "exit"); }
  }
  console.log(`Проверки качества данных: ${passed}/${passed}`);
} finally {
  server.close();
  if (disconnect) await disconnect();
  if (!/^afisha_quality_test_\d+$/.test(database)) throw new Error("Неверное имя временной базы");
  await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
