"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/server/admin";
import { audit } from "@/lib/server/audit";
import { ADAPTERS } from "@/lib/server/collect/adapters";
import { previewSource, runSource, SOURCE_KINDS, type PreviewResult, type SourceKind } from "@/lib/server/collect";
import { applySourceVenue } from "@/lib/server/collect/venue";
import { db } from "@/lib/server/db";
import type { ActionState } from "./actions";

// Источники событий: модератор и администратор. Каждое действие начинается с requireAdmin("MODERATOR")
// и пишет в журнал изменений.

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string, min: number, max: number, def: number) => {
  const n = Number(text(f, k));
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : def;
};
const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

/** Создать или сохранить источник. Новый — после сохранения открывается его карточка. */
export async function saveSource(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  const id = text(f, "id");
  try {
    const kind = text(f, "kind") as SourceKind;
    if (!(kind in SOURCE_KINDS)) throw new Error("Выберите тип источника");
    const name = text(f, "name");
    if (name.length < 3) throw new Error("Название — не короче 3 символов");
    const code = text(f, "code").toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(code)) throw new Error("Код — латиница, цифры, точка, дефис, подчёркивание; 2–40 символов");
    const url = text(f, "url");
    if (!/^https?:\/\/\S+$/.test(url)) throw new Error("Адрес должен начинаться с http:// или https://");
    const adapter = kind === "custom" ? text(f, "adapter") : "";
    if (kind === "custom" && !ADAPTERS[adapter]) throw new Error("Выберите индивидуальный парсер");
    // Координаты здания: «54.7230, 55.9446» (как копирует Яндекс Карты); пусто — найдутся по адресу
    const coords = text(f, "venueCoords");
    const m = coords.match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
    if (coords && !m) throw new Error("Координаты — «широта, долгота», например 54.7230, 55.9446");
    const [venueLat, venueLon] = m ? [Number(m[1].replace(",", ".")), Number(m[2].replace(",", "."))] : [null, null];
    if (venueLat != null && (venueLat < 51 || venueLat > 57 || venueLon! < 53 || venueLon! > 60.5)) throw new Error("Координаты вне Башкортостана — проверьте порядок: сначала широта (51–57), потом долгота (53–60)");
    const clash = await db.source.findUnique({ where: { code } });
    if (clash && clash.id !== id) throw new Error(`Код «${code}» уже занят источником «${clash.name}»`);
    const data = {
      name: name.slice(0, 200),
      code,
      kind,
      url: url.slice(0, 1000),
      adapter: adapter || null,
      city: text(f, "city").slice(0, 100) || null,
      // Разбор ИИ — всегда через модерацию, флаг не действует
      autoPublish: kind !== "rss_ai" && kind !== "html_ai" && f.get("autoPublish") === "on",
      enabled: f.get("enabled") === "on",
      intervalHours: num(f, "intervalHours", 1, 168, 12),
      maxItems: num(f, "maxItems", 1, 100, 20),
      note: text(f, "note").slice(0, 1000) || null,
      venueName: text(f, "venueName").slice(0, 200) || null,
      venueAddress: text(f, "venueAddress").slice(0, 300) || null,
      venueLat,
      venueLon,
    };
    if (id) {
      await db.source.update({ where: { id }, data });
      await audit({ userLogin: me.login, action: "update", entity: "source", entityId: id, summary: `Источник «${data.name}» изменён` });
      const fixed = await applySourceVenue(data).catch(() => 0);
      revalidatePath("/admin/sources");
      return { ok: true, message: fixed ? `Сохранено. Координаты уточнены у площадок: ${fixed}` : "Сохранено" };
    }
    const created = await db.source.create({ data: { ...data, createdBy: me.login } });
    await audit({ userLogin: me.login, action: "create", entity: "source", entityId: created.id, summary: `Добавлен источник «${data.name}» (${SOURCE_KINDS[kind].label})` });
    revalidatePath("/admin/sources");
    redirect(`/admin/sources/${created.id}`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect() из Next — пробрасываем
    return fail(e);
  }
}

/** Собрать сейчас: импорт с проверками, итог — в карточке источника. */
export async function runSourceNow(id: string): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    const r = await runSource(id, me.login);
    revalidatePath(`/admin/sources/${id}`);
    return { ok: true, message: r.message };
  } catch (e) {
    revalidatePath(`/admin/sources/${id}`);
    return fail(e);
  }
}

/** Проверить без записи: что прочитано и как пройдёт импорт. */
export async function previewSourceAction(id: string): Promise<{ ok: true; result: PreviewResult } | { ok: false; message: string }> {
  await requireAdmin("MODERATOR");
  try {
    return { ok: true, result: await previewSource(id) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Удалить источник. События, уже попавшие в афишу, остаются (у них своя ссылка на первоисточник). */
export async function deleteSource(id: string): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  const s = await db.source.delete({ where: { id } }).catch(() => null);
  if (!s) return { ok: false, message: "Источник не найден" };
  await audit({ userLogin: me.login, action: "delete", entity: "source", entityId: id, summary: `Удалён источник «${s.name}»` });
  revalidatePath("/admin/sources");
  redirect("/admin/sources");
}

/** «Разобрать заново»: забыть разобранные записи ленты — следующий сбор отправит их модели снова. */
export async function forgetSourceItems(id: string): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  const { count } = await db.sourceItem.deleteMany({ where: { sourceId: id } });
  await audit({ userLogin: me.login, action: "update", entity: "source", entityId: id, summary: `Сброшены разобранные записи ленты: ${count}` });
  revalidatePath(`/admin/sources/${id}`);
  return { ok: true, message: `Забыто записей: ${count}. Следующий сбор разберёт их заново.` };
}
