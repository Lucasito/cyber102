"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EventStatus } from "@/generated/prisma/client";
import { audit, diffFields } from "@/lib/server/audit";
import { mergeEvents } from "@/lib/server/dedup";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { resolveVenue } from "@/lib/server/venue-registry";
import { importRows, parseFile, type ImportReport } from "@/lib/server/import";
import { dedupKey, normalizeCity, normalizeTitle, parseAge, parseDate, parsePrice, parseTags, parseUrl } from "@/lib/server/normalize";
import type { ActionState } from "./actions";

// Работа с событиями: модератор и администратор. Каждое действие начинается с requireAdmin("MODERATOR")
// и пишет в журнал изменений (AuditLog).

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof Error ? e.message : String(e) });
function refresh() {
  revalidatePath("/", "layout");
}

const EDIT_FIELDS = ["title", "description", "startsAt", "endsAt", "durationMin", "status", "publication", "priceMin", "priceMax", "ageLimit", "categoryId", "venueId", "tags", "language", "orgUrl", "ticketUrl", "imageUrl", "pushkinCard", "needsReview", "reviewNote", "originalStartsAt"] as const;

/** Создать или сохранить событие из формы. Новое — ручной ввод (источник manual), ссылка на источник обязательна. */
export async function saveEvent(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  let createdId: string | null = null;
  try {
    const id = text(f, "id");
    const title = text(f, "title").replace(/\s+/g, " ");
    if (title.length < 3) throw new Error("Название — не короче 3 символов.");
    const startsAt = parseDate(text(f, "startsAt"));
    if (!startsAt) throw new Error("Укажите дату и время начала.");
    const endsAt = text(f, "endsAt") ? parseDate(text(f, "endsAt")) : null;
    if (text(f, "endsAt") && !endsAt) throw new Error("Не удалось разобрать дату окончания.");
    if (endsAt && endsAt < startsAt) throw new Error("Окончание раньше начала.");
    const cityRaw = text(f, "city");
    const venueName = text(f, "venue").replace(/\s+/g, " ");
    if (!cityRaw || !venueName) throw new Error("Укажите город и площадку.");
    const cities = (await db.venue.findMany({ distinct: ["city"], select: { city: true } })).map((v) => v.city);
    const city = normalizeCity(cityRaw, cities);
    const free = f.get("free") === "on";
    const pMin = parsePrice(text(f, "priceMin")).min;
    const pMax = parsePrice(text(f, "priceMax")).min;
    const priceMin = free ? 0 : pMin;
    const priceMax = free ? 0 : (pMax ?? pMin);
    if (priceMin != null && priceMax != null && priceMin > priceMax) throw new Error("Цена «от» больше цены «до».");
    const status = (["SCHEDULED", "RESCHEDULED", "CANCELLED", "SOLD_OUT"].includes(text(f, "status")) ? text(f, "status") : "SCHEDULED") as EventStatus;
    const publication = f.get("published") === "on" ? ("PUBLISHED" as const) : ("DRAFT" as const);
    const category = text(f, "category");
    const sourceUrl = parseUrl(text(f, "sourceUrl"));
    if (!id && !sourceUrl) throw new Error("Укажите ссылку на источник — у каждого события должен быть источник.");
    if (text(f, "sourceUrl") && !sourceUrl) throw new Error("Ссылка на источник не похожа на адрес http(s).");
    const duration = parseInt(text(f, "durationMin"), 10);

    const result = await db.$transaction(async (tx) => {
      const venue = await resolveVenue(tx, venueName, city);
      // Новый адрес — координаты найдутся заново фоновой задачей
      if (text(f, "address") && venue.address !== text(f, "address")) await tx.venue.update({ where: { id: venue.id }, data: { address: text(f, "address"), lat: null, lon: null, approx: true, geocodedAt: null, locationLocked: true, locationVerifiedAt: new Date() } });
      const before = id ? await tx.event.findUniqueOrThrow({ where: { id } }) : null;
      const rescheduled = before && before.startsAt.getTime() !== startsAt.getTime();
      const data = {
        title,
        normalizedTitle: normalizeTitle(title),
        description: text(f, "description") || null,
        startsAt,
        endsAt,
        durationMin: Number.isFinite(duration) && duration > 0 ? duration : null,
        status: rescheduled && status === "SCHEDULED" ? ("RESCHEDULED" as const) : status,
        publication,
        priceMin,
        priceMax,
        ageLimit: parseAge(text(f, "ageLimit")),
        categoryId: category ? ((await tx.category.findUnique({ where: { slug: category } }))?.id ?? null) : null,
        venueId: venue.id,
        tags: parseTags(text(f, "tags")),
        language: text(f, "language").toLowerCase() || null,
        orgUrl: parseUrl(text(f, "orgUrl")),
        ticketUrl: parseUrl(text(f, "ticketUrl")),
        imageUrl: parseUrl(text(f, "imageUrl")),
        pushkinCard: f.get("pushkinCard") === "on",
        // Модератор сохранил карточку — значит, проверил: снимаем пометку «спорная», если не оставил её явно
        needsReview: f.get("needsReview") === "on",
        reviewNote: f.get("needsReview") === "on" ? text(f, "reviewNote") || before?.reviewNote || "отмечено модератором" : null,
        ...(rescheduled ? { originalStartsAt: before.originalStartsAt ?? before.startsAt } : {}),
      };
      if (!before) {
        const key = dedupKey(title, startsAt, venue.name, venue.city);
        const twin = await tx.event.findUnique({ where: { dedupKey: key }, select: { id: true } });
        if (twin) throw new Error(`Такое событие уже есть (то же название, дата и площадка): /admin/events/${twin.id}`);
        const ev = await tx.event.create({
          data: { ...data, dedupKey: key, verifiedAt: new Date(), confidence: 1, sources: { create: { source: "manual", sourceType: "MANUAL", url: sourceUrl! } } },
        });
        await audit({ userLogin: me.login, action: "create", entity: "event", entityId: ev.id, summary: `Создано вручную: «${title}»` }, tx);
        return { id: ev.id, message: "Событие создано" };
      }
      const diff = diffFields(before as Record<string, unknown>, data, [...EDIT_FIELDS]);
      await tx.event.update({ where: { id }, data: { ...data, dedupKey: dedupKey(title, startsAt, venue.name, venue.city), verifiedAt: new Date() } });
      if (sourceUrl && !(await tx.eventSource.findFirst({ where: { eventId: id, url: sourceUrl } }))) {
        await tx.eventSource.create({ data: { eventId: id, source: "manual", sourceType: "MANUAL", url: sourceUrl } });
      }
      if (diff) await audit({ userLogin: me.login, action: "update", entity: "event", entityId: id, summary: `Изменено «${title}»`, diff }, tx);
      return { id, message: diff ? "Сохранено" : "Изменений нет" };
    });
    refresh();
    if (!id) createdId = result.id;
    else return { ok: true, message: result.message };
  } catch (e) {
    return fail(e);
  }
  redirect(`/admin/events/${createdId}?created=1`);
}

/** Опубликовать / снять с публикации / одобрить спорную / отменить / удалить — кнопки в списке и карточке. */
async function change(fn: (login: string) => Promise<string>): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    const message = await fn(me.login);
    refresh();
    return { ok: true, message };
  } catch (e) {
    return fail(e);
  }
}

export async function publishEvent(id: string) {
  return change(async (login) => {
    const e = await db.event.update({ where: { id }, data: { publication: "PUBLISHED", needsReview: false, reviewNote: null, verifiedAt: new Date() } });
    await audit({ userLogin: login, action: "publish", entity: "event", entityId: id, summary: `Опубликовано «${e.title}»` });
    return "Опубликовано";
  });
}

export async function unpublishEvent(id: string) {
  return change(async (login) => {
    const e = await db.event.update({ where: { id }, data: { publication: "DRAFT" } });
    await audit({ userLogin: login, action: "unpublish", entity: "event", entityId: id, summary: `Снято с публикации «${e.title}»` });
    return "Снято с публикации — на сайте не видно";
  });
}

export async function cancelEvent(id: string) {
  return change(async (login) => {
    const e = await db.event.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit({ userLogin: login, action: "cancel", entity: "event", entityId: id, summary: `Отменено «${e.title}» — убрано из выдачи, по прямой ссылке видно с пометкой` });
    return "Отменено: из выдачи убрано, по ссылке видно с пометкой";
  });
}

export async function rejectEvent(id: string) {
  return change(async (login) => {
    const e = await db.event.update({ where: { id }, data: { publication: "DRAFT", needsReview: false, reviewNote: "отклонено модератором" } });
    await audit({ userLogin: login, action: "reject", entity: "event", entityId: id, summary: `Отклонено «${e.title}» — остаётся черновиком` });
    return "Отклонено — остаётся черновиком";
  });
}

export async function deleteEvent(id: string) {
  const me = await requireAdmin("MODERATOR");
  try {
    const e = await db.event.delete({ where: { id } });
    await audit({ userLogin: me.login, action: "delete", entity: "event", entityId: id, summary: `Удалено «${e.title}»` });
    refresh();
  } catch (e) {
    return fail(e);
  }
  redirect("/admin/events?deleted=1");
}

// ── Дубли ────────────────────────────────────────────────────────────────────

/** Это одно событие: dropId сводится в keepId (ссылки на источники, пустые поля, напоминания), дубль удаляется. */
export async function mergeDuplicate(keepId: string, dropId: string): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    const r = await mergeEvents(keepId, dropId);
    await audit({ userLogin: me.login, action: "merge", entity: "event", entityId: keepId, summary: `Объединены дубли: «${r.dropTitle}» → «${r.keepTitle}»` });
    refresh();
    return { ok: true, message: `Объединено в «${r.keepTitle}»` };
  } catch (e) {
    return fail(e);
  }
}

/** Это разные события: пара больше не предлагается как дубль, пометка «возможный дубль» снимается. */
export async function markDistinct(aId: string, bId: string): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    const [a, b] = await Promise.all([db.event.findUniqueOrThrow({ where: { id: aId } }), db.event.findUniqueOrThrow({ where: { id: bId } })]);
    const clean = (note: string | null) => note?.split("; ").filter((x) => !x.startsWith("возможный дубль")).join("; ") || null;
    await db.$transaction([
      db.event.update({ where: { id: a.id }, data: { distinctFrom: [...new Set([...a.distinctFrom, b.id])], ...(a.possibleDuplicateId === b.id ? { possibleDuplicateId: null, reviewNote: clean(a.reviewNote) } : {}) } }),
      db.event.update({ where: { id: b.id }, data: { distinctFrom: [...new Set([...b.distinctFrom, a.id])], ...(b.possibleDuplicateId === a.id ? { possibleDuplicateId: null, reviewNote: clean(b.reviewNote) } : {}) } }),
    ]);
    await audit({ userLogin: me.login, action: "update", entity: "event", entityId: a.id, summary: `Не дубли: «${a.title}» и «${b.title}»` });
    refresh();
    return { ok: true, message: "Отмечено: разные события" };
  } catch (e) {
    return fail(e);
  }
}

// ── Импорт ───────────────────────────────────────────────────────────────────

export type ImportState = { ok: boolean; message: string; report?: ImportReport } | null;

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function importFile(_: ImportState, f: FormData): Promise<ImportState> {
  const me = await requireAdmin("MODERATOR");
  try {
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Выберите файл CSV или JSON.");
    if (file.size > MAX_FILE_BYTES) throw new Error("Файл больше 5 МБ — разделите его на части.");
    if (!/\.(csv|json|txt)$/i.test(file.name)) throw new Error("Нужен файл .csv или .json.");
    const content = new TextDecoder("utf-8").decode(await file.arrayBuffer());
    let rows: Record<string, unknown>[];
    try {
      rows = parseFile(content, file.name);
    } catch (e) {
      throw new Error(`Не удалось прочитать файл: ${e instanceof Error ? e.message : e}`);
    }
    if (!rows.length) throw new Error("В файле нет строк с событиями.");
    const source = text(f, "source") || file.name.replace(/\.[^.]+$/, "");
    const report = await importRows(rows, { fileName: file.name, source, userLogin: me.login });
    refresh();
    return {
      ok: true,
      message: `Строк: ${report.total}. Добавлено ${report.created}, обновлено ${report.updated}, без изменений ${report.unchanged}, отклонено ${report.rejected}.`,
      report,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ── Обращения ────────────────────────────────────────────────────────────────

export async function setFeedbackStatus(id: string, status: "new" | "done") {
  return change(async (login) => {
    await db.feedback.update({ where: { id }, data: { status, handledBy: status === "done" ? login : null } });
    await audit({ userLogin: login, action: status === "done" ? "feedback_done" : "feedback_reopen", entity: "feedback", entityId: id, summary: status === "done" ? "Обращение обработано" : "Обращение возвращено в новые" });
    return status === "done" ? "Отмечено как обработанное" : "Возвращено в новые";
  });
}
