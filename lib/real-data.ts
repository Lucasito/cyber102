// Тестовые данные — только реальные события (ТЗ: выдуманных мероприятий быть не должно ни на одном уровне).
// Снимок берётся из публичного API развёрнутой афиши: события из подключённых источников, у каждого — исходный
// источник и ссылка на первоисточник. Загружаются общим импортом (lib/server/import.ts) от имени своего источника.
//  • data/real-events.json — снимок в репозитории (npm run data:snapshot), для запуска без сети;
//  • при запуске на чистой машине сначала берётся свежий снимок из API, без сети — файл.
import { readFile } from "node:fs/promises";
import type { PrismaClient } from "@/generated/prisma/client";
import { importRows } from "./server/import";

/** Публичная афиша, из которой берётся свежий снимок (её API открыт и без ключа). */
export const SNAPSHOT_API = process.env.AFISHA_SNAPSHOT_URL ?? "https://afisha.193-47-33-213.sslip.io";
export const SNAPSHOT_FILE = new URL("../data/real-events.json", import.meta.url);
/** Сколько дней вперёд брать: дальше — мало событий, а снимок растёт за счёт киносеансов. */
const SNAPSHOT_DAYS = 30;

/** Справочник жанров (не события): нужен импорту, чтобы категория из источника распознавалась. */
export const CATEGORIES = [
  ["theatre", "Театр"],
  ["concert", "Концерты"],
  ["exhibition", "Выставки"],
  ["museum", "Музеи"],
  ["kids", "Детям"],
  ["cinema", "Кино"],
  ["festival", "Фестивали"],
  ["lecture", "Лекции"],
  ["excursion", "Экскурсии"],
] as const;

export async function ensureCategories(db: PrismaClient) {
  for (const [slug, name] of CATEGORIES) await db.category.upsert({ where: { slug }, create: { slug, name }, update: {} });
}

type ApiEvent = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  status: string;
  priceMin: number | null;
  priceMax: number | null;
  ageLimit: number | null;
  imageUrl: string | null;
  ticketUrl: string | null;
  pushkinCard: boolean;
  tags: string[];
  language: string | null;
  durationMin: number | null;
  venue: { name: string; city: string; address: string | null; lat: number | null; lon: number | null; approx: boolean } | null;
  category: { slug: string } | null;
  sources: { source: string; url: string }[];
};

/** Строка снимка: код исходного источника и строка импорта в универсальном формате (/docs/format). */
export type SnapshotRow = { source: string; row: Record<string, unknown> };
export type Snapshot = { takenAt: string; from: string; events: SnapshotRow[] };

export function toSnapshotRow(e: ApiEvent): SnapshotRow | null {
  const src = e.sources.find((s) => /^https?:\/\//.test(s.url));
  if (!src || !e.venue) return null; // без первоисточника и площадки событие в тестовые данные не берём
  const row: Record<string, unknown> = {
    externalId: e.id,
    title: e.title,
    dateStart: e.startsAt,
    dateEnd: e.endsAt ?? undefined,
    city: e.venue.city,
    venue: e.venue.name,
    address: e.venue.address ?? undefined,
    ...(e.venue.lat != null && e.venue.lon != null && !e.venue.approx ? { lat: e.venue.lat, lon: e.venue.lon } : {}),
    sourceUrl: src.url,
    priceMin: e.priceMin ?? undefined,
    priceMax: e.priceMax ?? undefined,
    ageLimit: e.ageLimit ?? undefined,
    category: e.category?.slug,
    description: e.description ?? undefined,
    ticketUrl: e.ticketUrl ?? undefined,
    imageUrl: e.imageUrl ?? undefined,
    status: e.status.toLowerCase(),
    pushkin: e.pushkinCard || undefined,
    tags: e.tags?.length ? e.tags.join(", ") : undefined,
    language: e.language ?? undefined,
    durationMin: e.durationMin ?? undefined,
  };
  return { source: src.source, row: Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== null && v !== "")) };
}

/**
 * Свежий снимок из публичного API: актуальные события на SNAPSHOT_DAYS дней. Запрос идёт по статусам — так поиск
 * отдаёт все сеансы кино, а не сводку для общей выдачи. Запросы по одному, с паузой.
 */
export async function fetchSnapshot(base = SNAPSHOT_API, now = new Date()): Promise<Snapshot> {
  const day = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Yekaterinburg" });
  const from = day(now), to = day(new Date(now.getTime() + SNAPSHOT_DAYS * 86_400_000));
  const events: SnapshotRow[] = [];
  const seen = new Set<string>();
  for (const status of ["SCHEDULED", "RESCHEDULED", "SOLD_OUT"]) {
    for (let offset = 0; offset < 5000; offset += 100) {
      const url = `${base.replace(/\/$/, "")}/api/v1/events?status=${status}&dateFrom=${from}&dateTo=${to}&limit=100&offset=${offset}`;
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "AfishaRB-snapshot/1.0" }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`${url}: код ${res.status}`);
      const page = (await res.json()) as { items: ApiEvent[]; total: number };
      for (const e of page.items) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        const r = toSnapshotRow(e);
        if (r) events.push(r);
      }
      if (offset + 100 >= page.total || !page.items.length) break;
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }
  return { takenAt: now.toISOString(), from: base, events };
}

export async function readSnapshotFile(): Promise<Snapshot> {
  return JSON.parse(await readFile(SNAPSHOT_FILE, "utf8")) as Snapshot;
}

/** Загрузить снимок общим импортом, по источникам. Прошедшие события импорт сам отклоняет. */
export async function loadSnapshot(db: PrismaClient, snap: Snapshot) {
  await ensureCategories(db);
  const bySource = new Map<string, Record<string, unknown>[]>();
  for (const { source, row } of snap.events) bySource.set(source, [...(bySource.get(source) ?? []), row]);
  let created = 0, rejected = 0;
  for (const [source, rows] of bySource) {
    const report = await importRows(rows, { fileName: `Снимок реальной афиши ${snap.takenAt.slice(0, 10)}`, source, sourceType: "IMPORT", userLogin: "snapshot" });
    created += report.created + report.updated + report.unchanged;
    rejected += report.rejected;
    // Публичный API отдаёт только опубликованные события — они уже прошли модерацию в исходной афише.
    // Замечания импорта («цена не указана») не повод прятать их снова: публикуем, как в источнике.
    const ids = report.rows.flatMap((r) => (r.result !== "rejected" && r.eventId ? [r.eventId] : []));
    if (ids.length) await db.event.updateMany({ where: { id: { in: ids } }, data: { publication: "PUBLISHED", needsReview: false, reviewNote: null } });
  }
  return { created, rejected, sources: bySource.size };
}
