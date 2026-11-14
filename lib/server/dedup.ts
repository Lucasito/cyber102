import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { normalizeTitle } from "./normalize";

// Нечёткий поиск дублей между источниками (ТЗ 6.5). Одно событие из разных источников приходит по-разному:
// «Спектакль «Любовь и голуби»» и «Любовь и голуби / Мөхәббәт һәм күгәрсендәр», «Филармония» и «Башкирская
// государственная филармония имени Х. Ахметова». Точный ключ таких не ловит — сравниваем по смыслу:
// ядро названия (без жанровых слов, возраста, перевода), время начала, город, значимые слова площадки.
//
// Уровни: same — явно одно событие (сводим в одну карточку); possible — похоже, решает модератор.

/** Слова, которые не отличают события: жанр, служебные, возраст. */
const TITLE_STOP = new Set([
  "спектакль", "концерт", "выставка", "мюзикл", "премьера", "программа", "музыкальная", "музыкальный", "показ", "лекция", "мастер", "класс",
  "экскурсия", "фестиваль", "постановка", "представление", "детский", "детская", "для", "детей", "семейный", "новый", "новая", "по", "на", "и", "в", "с",
  // Местоимения и служебные слова: «Моя тёща» и «Неспетая песня моя» — не одно событие
  "моя", "мой", "мое", "мои", "наш", "наша", "наше", "наши", "ваш", "это", "все", "весь", "вся", "как", "его", "она", "они", "что", "или", "без", "под",
  "над", "про", "при", "из", "от", "до", "так", "кто", "где", "там", "тут", "еще", "уже", "the", "and",
]);
/** Слова площадки, которые есть почти у всех: по ним площадки не различить. */
const VENUE_STOP = new Set([
  "театр", "зал", "государственный", "государственная", "башкирский", "башкирская", "республики", "республиканский", "центр", "дом", "культуры", "имени", "им",
  "рб", "башкортостан", "башкортостана", "концертный", "большой", "малый", "сцена", "городской", "муниципальный", "автономное", "учреждение", "гау", "мбу",
]);

const stem = (w: string) => w.slice(0, 6);

/** Ядро названия: до « / » (второй язык), без жанровых слов, чисел и коротких слов; слова — по основе. */
export function titleCore(title: string): Set<string> {
  const main = title.split(/\s\/\s|\s\|\s/)[0];
  return new Set(
    normalizeTitle(main)
      .split(" ")
      .filter((w) => w.length > 2 && !TITLE_STOP.has(w) && !/^\d+$/.test(w))
      .map(stem),
  );
}

function venueCore(venue: string): Set<string> {
  return new Set(
    normalizeTitle(venue)
      .split(" ")
      .filter((w) => w.length > 2 && !VENUE_STOP.has(w))
      .map((w) => w.slice(0, 4)), // «драмтеатр» и «драматический» → «драм»
  );
}

/** Порог похожести названий: на той же площадке достаточно половины слов, на разных — почти полное совпадение. */
export function dupLevel(score: number, sameVenue: boolean): DupLevel | null {
  if (sameVenue) return score >= 0.8 ? "same" : score >= 0.5 ? "possible" : null;
  // Разные площадки в одно время: одно событие бывает (разные названия площадки у источников), но только при
  // почти одинаковом названии — «Новогодняя ёлка» в двух театрах решает модератор
  return score >= 0.8 ? "possible" : null;
}

/** Похожесть названий 0–1: доля общих слов от короткого названия (перевод и жанр не мешают). */
export function titleScore(a: string, b: string) {
  const A = titleCore(a);
  const B = titleCore(b);
  if (!A.size || !B.size) return normalizeTitle(a) === normalizeTitle(b) ? 1 : 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size);
}

export function venueMatch(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  if (normalizeTitle(a) === normalizeTitle(b)) return true;
  const A = venueCore(a);
  const B = venueCore(b);
  for (const w of A) if (B.has(w)) return true;
  return false;
}

export type DupLevel = "same" | "possible";
export type DupCandidate = { id: string; title: string; startsAt: Date; venueName: string | null; level: DupLevel; score: number };

const WINDOW_MS = 30 * 60_000;

/**
 * Похожее событие в базе для новой записи (того же города, начало в пределах 30 минут; у выставок — пересечение дат).
 * excludeId — не сравнивать с собой. Возвращает лучшего кандидата или null.
 */
export async function findDuplicate(
  tx: Prisma.TransactionClient,
  rec: { title: string; startsAt: Date; endsAt: Date | null; city: string; venue: string },
  excludeId?: string,
): Promise<DupCandidate | null> {
  const multiDay = !!rec.endsAt && rec.endsAt.getTime() - rec.startsAt.getTime() > 12 * 3_600_000;
  const rows = await tx.event.findMany({
    where: {
      id: excludeId ? { not: excludeId } : undefined,
      status: { not: "PAST" },
      venue: { city: { equals: rec.city, mode: "insensitive" } },
      ...(multiDay
        ? { startsAt: { lte: rec.endsAt! }, OR: [{ endsAt: { gte: rec.startsAt } }, { startsAt: { gte: rec.startsAt } }] }
        : { startsAt: { gte: new Date(rec.startsAt.getTime() - WINDOW_MS), lte: new Date(rec.startsAt.getTime() + WINDOW_MS) } }),
    },
    select: { id: true, title: true, startsAt: true, endsAt: true, venue: { select: { name: true } } },
    take: 200,
  });
  let best: DupCandidate | null = null;
  for (const e of rows) {
    const score = titleScore(rec.title, e.title);
    // Явный дубль — почти то же название на той же площадке; остальное — «возможный», решает модератор
    const level = dupLevel(score, venueMatch(rec.venue, e.venue?.name));
    if (!level) continue;
    const cand = { id: e.id, title: e.title, startsAt: e.startsAt, venueName: e.venue?.name ?? null, level, score };
    if (!best || (cand.level === "same" && best.level !== "same") || (cand.level === best.level && cand.score > best.score)) best = cand;
  }
  return best;
}

/** Возможные дубли среди актуальных событий — для модерации (пары, сначала самые похожие). */
export async function scanDuplicates(limit = 50) {
  const events = await db.event.findMany({
    // Кино не сравниваем: один фильм в одно время в разных кинотеатрах — разные сеансы (см. importRows)
    where: { status: { notIn: ["PAST"] }, OR: [{ startsAt: { gte: new Date() } }, { endsAt: { gte: new Date() } }], NOT: { category: { is: { slug: "cinema" } } } },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      publication: true,
      createdAt: true,
      distinctFrom: true,
      venue: { select: { name: true, city: true } },
      sources: { select: { source: true, url: true }, take: 2 },
    },
    orderBy: { startsAt: "asc" },
    take: 3000,
  });
  type E = (typeof events)[number];
  const pairs: { a: E; b: E; level: DupLevel; score: number }[] = [];
  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      if (b.startsAt.getTime() - a.startsAt.getTime() > WINDOW_MS) break; // отсортированы по началу
      if (!a.venue || !b.venue || a.venue.city.toLowerCase() !== b.venue.city.toLowerCase()) continue;
      if (a.distinctFrom.includes(b.id) || b.distinctFrom.includes(a.id)) continue; // модератор уже решил: разные
      const score = titleScore(a.title, b.title);
      const level = dupLevel(score, venueMatch(a.venue.name, b.venue.name));
      if (level) pairs.push({ a, b, score, level });
    }
  }
  return pairs.sort((x, y) => Number(y.level === "same") - Number(x.level === "same") || y.score - x.score).slice(0, limit);
}

/**
 * Свести событие dropId в keepId: ссылки на источники переходят к оставшемуся, пустые поля дополняются,
 * напоминания переносятся, дубль удаляется. Возвращает названия для журнала.
 */
export async function mergeEvents(keepId: string, dropId: string) {
  return db.$transaction((tx) => mergeEventsInTransaction(tx, keepId, dropId));
}

export async function mergeEventsInTransaction(tx: Prisma.TransactionClient, keepId: string, dropId: string) {
  if (keepId === dropId) throw new Error("Нельзя объединить событие само с собой");
    const keep = await tx.event.findUniqueOrThrow({ where: { id: keepId }, include: { sources: true } });
    const drop = await tx.event.findUniqueOrThrow({ where: { id: dropId }, include: { sources: true } });
    for (const s of drop.sources) {
      const exists = keep.sources.some((k) => k.source === s.source && k.url === s.url);
      if (exists) await tx.eventSource.delete({ where: { id: s.id } });
      else await tx.eventSource.update({ where: { id: s.id }, data: { eventId: keep.id } });
    }
    const fill: Prisma.EventUpdateInput = {};
    const keys = ["description", "endsAt", "durationMin", "priceMin", "priceMax", "ageLimit", "orgUrl", "ticketUrl", "imageUrl", "language"] as const;
    for (const k of keys) if (keep[k] == null && drop[k] != null) (fill as Record<string, unknown>)[k] = drop[k];
    if (!keep.categoryId && drop.categoryId) fill.category = { connect: { id: drop.categoryId } };
    if (!keep.tags.length && drop.tags.length) fill.tags = drop.tags;
    if (keep.possibleDuplicateId === drop.id) fill.possibleDuplicateId = null;
    if (Object.keys(fill).length) await tx.event.update({ where: { id: keep.id }, data: fill });
    // Напоминания: у кого уже есть напоминание о keep — дубль не нужен
    const reminders = await tx.reminder.findMany({ where: { eventId: drop.id } });
    for (const r of reminders) {
      const has = await tx.reminder.findFirst({ where: { eventId: keep.id, botUserId: r.botUserId } });
      if (has) await tx.reminder.delete({ where: { id: r.id } });
      else await tx.reminder.update({ where: { id: r.id }, data: { eventId: keep.id } });
    }
    for (const w of await tx.eventWatch.findMany({ where: { eventId: drop.id } })) {
      const exists = await tx.eventWatch.findUnique({ where: { botUserId_eventId: { botUserId: w.botUserId, eventId: keep.id } } });
      if (exists) await tx.eventWatch.delete({ where: { id: w.id } });
      else await tx.eventWatch.update({ where: { id: w.id }, data: { eventId: keep.id } });
    }
    await tx.event.updateMany({ where: { possibleDuplicateId: drop.id }, data: { possibleDuplicateId: keep.id } });
    await tx.rawRecord.updateMany({ where: { eventId: drop.id }, data: { eventId: keep.id } });
    await tx.sourceItem.updateMany({ where: { eventId: drop.id }, data: { eventId: keep.id } });
    await tx.dataChange.updateMany({ where: { entity: "event", entityId: drop.id, status: "pending" }, data: { status: "superseded" } });
    await tx.event.delete({ where: { id: drop.id } });
    return { keepTitle: keep.title, dropTitle: drop.title };
}
