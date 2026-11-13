import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

// Невидимая админка: без cookie любой адрес /admin отвечает 404, как несуществующая страница.
// Вход — по секретной ссылке /admin/enter/<ADMIN_KEY>: она ставит cookie на 30 дней.
// ADMIN_KEY не задан — админка выключена полностью.

export const ADMIN_COOKIE = "afisha_adm";
export const ADMIN_MAX_AGE = 30 * 24 * 3600;

function adminKey() {
  const key = process.env.ADMIN_KEY ?? "";
  return key.length >= 16 ? key : ""; // короткий ключ не принимаем — его можно подобрать
}

/** Значение cookie — подпись ключа, сам ключ в браузер не попадает. Смена ADMIN_KEY разлогинивает всех. */
export function sessionValue() {
  const key = adminKey();
  return key ? createHmac("sha256", key).update("afisha-admin-session").digest("hex") : "";
}

function safeEqual(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function checkEnterKey(given: string) {
  const key = adminKey();
  return !!key && safeEqual(given, key);
}

export async function isAdmin() {
  const expected = sessionValue();
  if (!expected) return false;
  const got = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  return safeEqual(got, expected);
}

/** Для страниц и server actions админки: чужим — 404. */
export async function requireAdmin() {
  if (!(await isAdmin())) notFound();
}
