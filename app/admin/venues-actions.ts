"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/server/admin";
import { audit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { geocode, isBashkortostanRegion } from "@/lib/server/geocode";
import type { ActionState } from "./actions";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/**
 * Уточнить площадку: город, адрес, координаты. Координаты заданы — точные; иначе — поиск по адресу геокодером
 * (только в Башкортостане). Не нашлось — остаётся центр города с пометкой «адрес уточняется».
 */
export async function saveVenue(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    const id = text(f, "id");
    const v = await db.venue.findUniqueOrThrow({ where: { id } });
    const city = text(f, "city").slice(0, 100) || v.city;
    const address = text(f, "address").slice(0, 300) || null;
    const coords = text(f, "coords");
    const m = coords.match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
    if (coords && !m) throw new Error("Координаты — «широта, долгота», например 54.7230, 55.9446");
    let lat = m ? Number(m[1].replace(",", ".")) : null;
    let lon = m ? Number(m[2].replace(",", ".")) : null;
    if (lat != null && (lat < 51 || lat > 57 || lon! < 53 || lon! > 60.5)) throw new Error("Координаты вне Башкортостана — сначала широта (51–57), потом долгота (53–60)");
    const clash = city !== v.city ? await db.venue.findUnique({ where: { name_city: { name: v.name, city } } }) : null;
    if (clash) throw new Error(`В городе ${city} уже есть площадка «${v.name}» — объединение площадок пока вручную`);
    let how = "координаты заданы вручную";
    if (lat == null && address) {
      const g = await geocode(`${address}, ${city}, Башкортостан`);
      if (g?.found && isBashkortostanRegion(g.region)) {
        ({ lat, lon } = g);
        how = "координаты найдены по адресу";
      } else how = "по адресу не нашлось — остался центр города";
    }
    const exact = lat != null && lon != null;
    await db.venue.update({
      where: { id },
      data: { city, address, ...(exact ? { lat, lon, approx: false } : {}), geocodedAt: new Date() },
    });
    await audit({ userLogin: me.login, action: "update", entity: "venue", entityId: id, summary: `Площадка «${v.name}»: ${city}${address ? `, ${address}` : ""} — ${how}` });
    revalidatePath("/admin/venues");
    return { ok: exact, message: exact ? `Сохранено: ${how}` : `Сохранено, но ${how}. Укажите координаты вручную (Яндекс Карты → правый клик → «Что здесь?»)` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
