"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { publicBase } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { spamCheck } from "@/lib/server/feedback";
import { log } from "@/lib/server/log";
import { mailTemplates, sendMailQuietly } from "@/lib/server/mail";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/server/password";

export type ApplyState = { ok: boolean; message: string } | null;

const schema = z.object({
  organization: z.string().trim().min(2, "Укажите учреждение или организацию").max(200),
  name: z.string().trim().min(2, "Укажите контактное лицо").max(100),
  email: z.string().trim().toLowerCase().email("Почта указана с ошибкой").max(150),
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().url("Сайт — ссылкой вида https://…").max(300).optional(),
  note: z.string().trim().max(1000).optional(),
  login: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "Логин: 3–32 символа, латиница в нижнем регистре, цифры, точка, дефис, подчёркивание"),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Пароль — не короче ${MIN_PASSWORD_LENGTH} символов`).max(200),
  consent: z.literal("on", { message: "Нужно согласие на обработку персональных данных" }),
});

/**
 * Заявка на кабинет организатора с сайта. Учётная запись создаётся закрытой (pendingApproval) — войти можно
 * после одобрения модератором. Защита как у обратной связи: ловушка для ботов, время заполнения, лимит с адреса.
 */
export async function applyOrganizer(_: ApplyState, f: FormData): Promise<ApplyState> {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const get = (k: string) => String(f.get(k) ?? "").trim() || undefined;
  const parsed = schema.safeParse({
    organization: get("organization") ?? "",
    name: get("name") ?? "",
    email: get("email") ?? "",
    phone: get("phone"),
    website: get("site"),
    note: get("note"),
    login: get("login") ?? "",
    password: String(f.get("password") ?? ""),
    consent: f.get("consent") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Проверьте поля формы." };
  const d = parsed.data;
  const started = Number(f.get("started") ?? 0);
  const spam = spamCheck(ip, { honeypot: get("website"), elapsedMs: started ? Date.now() - started : undefined, message: d.note ?? d.organization });
  if (spam === "spam") return { ok: true, message: "Заявка отправлена." }; // боту не подсказываем, что его поймали
  if (spam) return { ok: false, message: spam };
  if (await db.adminUser.findUnique({ where: { login: d.login } })) return { ok: false, message: `Логин «${d.login}» уже занят — выберите другой.` };
  if (await db.adminUser.findUnique({ where: { email: d.email } })) return { ok: false, message: "С этой почтой уже есть учётная запись. Забыли пароль — восстановите его на странице входа." };

  const user = await db.adminUser.create({
    data: {
      login: d.login,
      email: d.email,
      name: d.name,
      organization: d.organization,
      phone: d.phone ?? null,
      website: d.website ?? null,
      applicationNote: d.note ?? null,
      role: "ORGANIZER",
      active: false,
      pendingApproval: true,
      passwordHash: await hashPassword(d.password),
    },
  });
  log("info", "organizer_applied", { id: user.id });
  // Письмо модераторам и администраторам с почтой
  const base = await publicBase();
  const staff = await db.adminUser.findMany({ where: { active: true, role: { in: ["ADMIN", "MODERATOR"] }, email: { not: null } }, select: { email: true } });
  for (const s of staff) void sendMailQuietly(s.email, mailTemplates.organizerApplication(d.organization, d.login, `${base}/admin/organizers`));
  return { ok: true, message: "Заявка отправлена. Модератор проверит её — о решении придёт письмо на указанную почту. После одобрения войдите с выбранным логином и паролем." };
}
