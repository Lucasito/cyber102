"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminToken, dropSessions, readAdminToken, signIn, markAdminTokenUsed } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { mailTemplates, sendMailQuietly } from "@/lib/server/mail";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/server/password";

// Действия админки без requireAdmin: вход, «забыли пароль», новый пароль по ссылке из письма.
// Каждое само защищается: ограничение частоты, одинаковые ответы, одноразовые ссылки.

export async function login(_: string | null, f: FormData): Promise<string | null> {
  const loginName = String(f.get("login") ?? "").trim();
  const password = String(f.get("password") ?? "");
  if (!loginName || !password) return "Введите логин и пароль.";
  const error = await signIn(loginName.slice(0, 64), password.slice(0, 256));
  if (error) return error;
  redirect("/admin");
}

// Не больше 5 писем восстановления за 15 минут с одного адреса — защита от рассылки писем чужим людям
const forgotHits = new Map<string, number[]>();

export type FormResult = { ok: boolean; message: string } | null;

export async function forgotPassword(_: FormResult, f: FormData): Promise<FormResult> {
  const who = String(f.get("who") ?? "").trim().toLowerCase().slice(0, 254);
  if (!who) return { ok: false, message: "Введите логин или почту." };
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const hits = (forgotHits.get(ip) ?? []).filter((t) => now - t < 15 * 60_000);
  if (hits.length >= 5) return { ok: false, message: "Слишком много запросов. Попробуйте через 15 минут." };
  forgotHits.set(ip, [...hits, now]);

  const user = await db.adminUser.findFirst({ where: { active: true, email: { not: null }, OR: [{ login: who }, { email: who }] } });
  if (user?.email) await sendMailQuietly(user.email, mailTemplates.reset(user.login, await createAdminToken(user.id, "reset")));
  // Ответ одинаковый — по нему нельзя узнать, есть ли такой пользователь
  return { ok: true, message: "Если такой пользователь есть и у него указана почта, мы отправили письмо со ссылкой. Ссылка действует 1 час." };
}

export async function setPasswordByToken(_: FormResult, f: FormData): Promise<FormResult> {
  const token = String(f.get("token") ?? "");
  const password = String(f.get("password") ?? "");
  const found = await readAdminToken(token);
  if (!found) return { ok: false, message: "Ссылка устарела или уже использована. Запросите новую на странице входа." };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, message: `Пароль — не короче ${MIN_PASSWORD_LENGTH} символов.` };
  if (password !== String(f.get("password2") ?? "")) return { ok: false, message: "Пароли не совпадают." };
  await db.adminUser.update({ where: { id: found.user.id }, data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } });
  await markAdminTokenUsed(token);
  await dropSessions(found.user.id);
  if (found.kind === "reset") await sendMailQuietly(found.user.email, mailTemplates.passwordChanged(found.user.login));
  redirect("/admin/login?done=1");
}
