import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { AdminRole } from "@/generated/prisma/client";
import { db } from "./db";
import { DUMMY_HASH, verifyPassword } from "./password";

// Вход в админку: логин и пароль пользователя (таблица AdminUser) → сессия в базе, в cookie — случайный токен.
// Роли: ADMIN — всё; MODERATOR — работа с событиями. Первого администратора создаёт scripts/admin-user.mts.

export const ADMIN_COOKIE = "afisha_adm";
export const ADMIN_MAX_AGE = 30 * 24 * 3600;
const RANK: Record<AdminRole, number> = { ORGANIZER: 0, MODERATOR: 1, ADMIN: 2 };

export type AdminUserInfo = { id: string; login: string; name: string | null; role: AdminRole };

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Текущий пользователь админки или null. Кэшируется на время одного запроса. */
export const currentAdmin = cache(async (): Promise<AdminUserInfo | null> => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const session = await db.adminSession.findUnique({
    where: { id: tokenHash(token) },
    select: { expiresAt: true, user: { select: { id: true, login: true, name: true, role: true, active: true } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  const { id, login, name, role } = session.user;
  return { id, login, name, role };
});

/**
 * Для страниц и server actions админки. Без входа — на страницу входа; роль ниже нужной — 404.
 * По умолчанию нужна роль ADMIN; для работы с событиями — requireAdmin("MODERATOR").
 */
export async function requireAdmin(role: AdminRole = "ADMIN"): Promise<AdminUserInfo> {
  const user = await currentAdmin();
  if (!user) redirect("/admin/login");
  if (RANK[user.role] < RANK[role]) notFound();
  return user;
}

async function secureCookie() {
  const h = await headers();
  return h.get("x-forwarded-proto") === "https" || (process.env.PUBLIC_URL ?? "").startsWith("https:");
}

// Защита от подбора пароля, три уровня:
//  1) логин: после LOCK_AFTER неудач подряд вход закрыт на LOCK_MINUTES (хранится в базе — переживает перезапуск);
//  2) адрес: не больше IP_ATTEMPTS неудач за IP_WINDOW_MS с одного IP (в памяти процесса) — против перебора логинов;
//  3) каждая неудача отвечает не раньше чем через FAIL_DELAY_MS — перебор становится медленным.
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const IP_ATTEMPTS = 20;
const IP_WINDOW_MS = 15 * 60_000;
const FAIL_DELAY_MS = 1000;
const ipFailures = new Map<string, number[]>();

function ipBlocked(ip: string) {
  const now = Date.now();
  for (const [k, v] of ipFailures) if (!v.some((t) => now - t < IP_WINDOW_MS)) ipFailures.delete(k);
  return (ipFailures.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS).length >= IP_ATTEMPTS;
}

const minutesLeft = (until: Date) => Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));

/** Проверить логин и пароль, создать сессию и поставить cookie. Возвращает текст ошибки или null. */
export async function signIn(login: string, password: string): Promise<string | null> {
  const started = Date.now();
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const failed = async (message: string) => {
    ipFailures.set(ip, [...(ipFailures.get(ip) ?? []), Date.now()]);
    await new Promise((r) => setTimeout(r, Math.max(0, FAIL_DELAY_MS - (Date.now() - started))));
    console.warn(JSON.stringify({ event: "admin_login_failed", ip, login: login.slice(0, 32) }));
    return message;
  };
  if (ipBlocked(ip)) return failed("Слишком много неудачных попыток входа с вашего адреса. Попробуйте через 15 минут.");

  const user = await db.adminUser.findUnique({ where: { login: login.toLowerCase() } });
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    // Пароль при блокировке не проверяем вовсе: подбор во время блокировки бесполезен
    return failed(`Вход для этого логина временно закрыт после неудачных попыток. Попробуйте через ${minutesLeft(user.lockedUntil)} мин.`);
  }
  // Проверяем пароль и для несуществующего логина — чтобы по времени ответа нельзя было узнать, есть ли он
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.active) {
    if (user) {
      const failedLogins = user.failedLogins + 1;
      const lock = failedLogins >= LOCK_AFTER;
      await db.adminUser.update({
        where: { id: user.id },
        data: { failedLogins: lock ? 0 : failedLogins, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined },
      });
    }
    return failed("Неверный логин или пароль.");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ADMIN_MAX_AGE * 1000);
  await db.$transaction([
    db.adminSession.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } }),
    db.adminSession.create({ data: { id: tokenHash(token), userId: user.id, expiresAt } }),
    db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } }),
  ]);
  (await cookies()).set(ADMIN_COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", secure: await secureCookie(), maxAge: ADMIN_MAX_AGE });
  return null;
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) await db.adminSession.deleteMany({ where: { id: tokenHash(token) } });
  jar.delete(ADMIN_COOKIE);
}

// ── Одноразовые ссылки из писем: сброс пароля (1 час) и приглашение (24 часа) ──

export type AdminTokenKind = "reset" | "invite";
const TOKEN_TTL_MS: Record<AdminTokenKind, number> = { reset: 3_600_000, invite: 24 * 3_600_000 };

/** Адрес сайта для ссылок в письмах. */
export async function publicBase() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
}

/** Новая ссылка; прежние неиспользованные ссылки пользователя перестают работать. */
export async function createAdminToken(userId: string, kind: AdminTokenKind) {
  const token = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.adminToken.deleteMany({ where: { userId, usedAt: null } }),
    db.adminToken.create({ data: { id: tokenHash(token), userId, kind, expiresAt: new Date(Date.now() + TOKEN_TTL_MS[kind]) } }),
  ]);
  return `${await publicBase()}/admin/reset/${token}`;
}

/** Действующая ссылка → пользователь; иначе null. */
export async function readAdminToken(token: string) {
  const row = await db.adminToken.findUnique({ where: { id: tokenHash(token) }, include: { user: { select: { id: true, login: true, email: true, active: true } } } });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.active) return null;
  return { kind: row.kind as AdminTokenKind, user: row.user };
}

export async function markAdminTokenUsed(token: string) {
  await db.adminToken.update({ where: { id: tokenHash(token) }, data: { usedAt: new Date() } });
}

/** Закрыть все сессии пользователя (после смены пароля по ссылке, отключения и т. п.). */
export async function dropSessions(userId: string) {
  await db.adminSession.deleteMany({ where: { userId } });
}
