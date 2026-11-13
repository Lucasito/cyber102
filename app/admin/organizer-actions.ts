"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, type AdminUserInfo } from "@/lib/server/admin";
import { audit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { importRows, parseFile } from "@/lib/server/import";
import type { ActionState } from "./actions";
import type { ImportState } from "./events-actions";

// Кабинет организатора: событие по одному или файлом. Всё идёт через общий импорт в режиме модерации —
// те же проверки (Башкортостан, дата, дубли), новые события — черновиком в очередь, существующие в афише не меняются.
// Каждое действие начинается с requireAdmin("ORGANIZER"); модератор и администратор тоже могут ими пользоваться.

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const MAX_FILE_BYTES = 5 * 1024 * 1024;

async function reviewNote(me: AdminUserInfo) {
  const u = await db.adminUser.findUnique({ where: { id: me.id }, select: { organization: true } });
  return `от организатора ${me.login}${u?.organization ? ` (${u.organization})` : ""}`;
}

/** Одно событие из формы → в очередь модерации. */
export async function submitEvent(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireAdmin("ORGANIZER");
  try {
    const row: Record<string, unknown> = {
      title: text(f, "title"),
      dateStart: text(f, "dateStart"),
      dateEnd: text(f, "dateEnd") || undefined,
      city: text(f, "city"),
      venue: text(f, "venue"),
      address: text(f, "address") || undefined,
      priceMin: text(f, "priceMin") || undefined,
      priceMax: text(f, "priceMax") || undefined,
      isFree: f.get("isFree") === "on" ? true : undefined,
      ageLimit: text(f, "ageLimit") || undefined,
      category: text(f, "category") || undefined,
      description: text(f, "description") || undefined,
      sourceUrl: text(f, "sourceUrl"),
      ticketUrl: text(f, "ticketUrl") || undefined,
      pushkin: f.get("pushkin") === "on" ? true : undefined,
    };
    const report = await importRows([row], {
      fileName: "Кабинет организатора",
      source: `org-${me.login}`,
      sourceType: "MANUAL",
      userLogin: me.login,
      createdById: me.id,
      review: await reviewNote(me),
    });
    const r = report.rows[0];
    revalidatePath("/admin/my");
    if (r.result === "created") return { ok: true, message: "Событие отправлено на модерацию. Статус — в «Моих событиях»." };
    if (r.result === "rejected") return { ok: false, message: `Не принято: ${r.reason}` };
    return { ok: false, message: "Такое событие уже есть в афише. Если в нём ошибка — напишите через «Обратную связь» на сайте." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Файл CSV/JSON → все новые события в очередь модерации. */
export async function organizerImportFile(_: ImportState, f: FormData): Promise<ImportState> {
  const me = await requireAdmin("ORGANIZER");
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
    if (rows.length > 500) throw new Error("Не больше 500 событий за раз.");
    const report = await importRows(rows, {
      fileName: file.name,
      source: `org-${me.login}`,
      sourceType: "IMPORT",
      userLogin: me.login,
      createdById: me.id,
      review: await reviewNote(me),
    });
    revalidatePath("/admin/my");
    return {
      ok: true,
      message: `Строк: ${report.total}. На модерацию: ${report.created}, уже есть в афише: ${report.unchanged + report.updated}, не принято: ${report.rejected}.`,
      report,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Отозвать своё неопубликованное событие. */
export async function withdrawEvent(id: string): Promise<ActionState> {
  const me = await requireAdmin("ORGANIZER");
  const e = await db.event.findUnique({ where: { id }, select: { title: true, createdById: true, publication: true } });
  if (!e || e.createdById !== me.id) return { ok: false, message: "Событие не найдено" };
  if (e.publication === "PUBLISHED") return { ok: false, message: "Событие уже опубликовано — изменить его можно через модератора" };
  await db.event.delete({ where: { id } });
  await audit({ userLogin: me.login, action: "delete", entity: "event", entityId: id, summary: `Организатор отозвал «${e.title}»` });
  revalidatePath("/admin/my");
  return { ok: true, message: "Событие отозвано" };
}
