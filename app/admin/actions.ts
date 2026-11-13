"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearDemo, seedDemo } from "@/lib/demo-data";
import { createAdminToken, dropSessions, requireAdmin, signOut } from "@/lib/server/admin";
import { mailReady, mailTemplates, sendMail, sendMailQuietly } from "@/lib/server/mail";
import { aiProviderName, chat } from "@/lib/server/ai";
import { db } from "@/lib/server/db";
import { generatePassword, hashPassword, MIN_PASSWORD_LENGTH, ROLE_LABELS } from "@/lib/server/password";
import type { AdminRole } from "@/generated/prisma/client";
import { maxGetMe } from "@/lib/server/max";
import { getSettings, maxToken, pick, saveSettings, settingsSchema, telegramConfig, type Settings } from "@/lib/server/settings";
import { telegramGetMe } from "@/lib/server/telegram";

// Каждое действие проверяет доступ: server actions — это открытые POST-эндпоинты.

export type ActionState = { ok: boolean; message: string } | null;

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const flag = (f: FormData, k: string) => f.get(k) === "on";
/** Секретное поле: пусто — оставить прежнее значение; галочка «очистить» — удалить. */
const secret = (f: FormData, k: string, old: string) => (flag(f, `clear_${k}`) ? "" : text(f, k) || old);

function done(message: string): ActionState {
  revalidatePath("/", "layout");
  return { ok: true, message };
}
const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

export async function saveSite(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    await saveSettings("site", {
      heroTitle: text(f, "heroTitle"),
      heroSubtitle: text(f, "heroSubtitle"),
      notice: text(f, "notice"),
      testBanner: flag(f, "testBanner"),
      examples: text(f, "examples").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 6),
    });
    return done("Настройки сайта сохранены");
  } catch (e) {
    return fail(e);
  }
}

export async function saveAi(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const old = await getSettings("ai");
    await saveSettings("ai", {
      enabled: flag(f, "enabled"),
      provider: text(f, "provider") as Settings<"ai">["provider"],
      gigachatModel: text(f, "gigachatModel"),
      gigachatAuthKey: secret(f, "gigachatAuthKey", old.gigachatAuthKey),
      gigachatScope: text(f, "gigachatScope") as Settings<"ai">["gigachatScope"],
      llmApiUrl: text(f, "llmApiUrl"),
      llmApiKey: secret(f, "llmApiKey", old.llmApiKey),
      llmModel: text(f, "llmModel"),
      extraPrompt: text(f, "extraPrompt"),
      concurrency: Math.min(10, Math.max(1, Number(text(f, "concurrency")) || 1)),
      fallback: flag(f, "fallback"),
      rateIpMinute: Math.max(0, Number(text(f, "rateIpMinute")) || 0),
      rateIpDay: Math.max(0, Number(text(f, "rateIpDay")) || 0),
      rateUserMinute: Math.max(0, Number(text(f, "rateUserMinute")) || 0),
      rateUserDay: Math.max(0, Number(text(f, "rateUserDay")) || 0),
    });
    return done(`Сохранено. Сейчас используется: ${(await aiProviderName()) ?? "ИИ выключен"}`);
  } catch (e) {
    return fail(e);
  }
}

export async function testAi(): Promise<ActionState> {
  await requireAdmin();
  try {
    const started = Date.now();
    const answer = await chat([{ role: "user", content: "Ответь одним словом: столица Башкортостана?" }], { maxTokens: 20 });
    return { ok: true, message: `${await aiProviderName()}: «${answer.trim()}» за ${Date.now() - started} мс` };
  } catch (e) {
    return fail(e);
  }
}

export async function saveMax(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const old = await getSettings("max");
    await saveSettings("max", { enabled: flag(f, "enabled"), token: secret(f, "token", old.token), greeting: text(f, "greeting") });
    return done("Настройки MAX сохранены — применяются сразу");
  } catch (e) {
    return fail(e);
  }
}

export async function testMax(): Promise<ActionState> {
  await requireAdmin();
  try {
    const token = await maxToken();
    if (!token) return { ok: false, message: "Бот выключен или токен не задан" };
    const me = await maxGetMe(token);
    return { ok: true, message: `Бот «${me.name}» (@${me.username ?? me.user_id}) отвечает` };
  } catch (e) {
    return fail(e);
  }
}

export async function saveTelegram(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const old = await getSettings("telegram");
    await saveSettings("telegram", {
      enabled: flag(f, "enabled"),
      token: secret(f, "token", old.token),
      apiUrl: text(f, "apiUrl"),
      mode: text(f, "mode") === "webhook" ? "webhook" : "polling",
      greeting: text(f, "greeting"),
    });
    return done("Настройки Telegram сохранены — применяются сразу");
  } catch (e) {
    return fail(e);
  }
}

export async function testTelegram(): Promise<ActionState> {
  await requireAdmin();
  try {
    const cfg = await telegramConfig();
    if (!cfg.token) return { ok: false, message: "Токен не задан" };
    const me = await telegramGetMe(cfg.token, cfg.apiUrl);
    return { ok: true, message: `Бот @${me.username} доступен через ${cfg.apiUrl}` };
  } catch (e) {
    return fail(e);
  }
}

/** Числовые поля раздела «Параметры» — берём все, что объявлены в схеме, кроме текстов и списков. */
const TUNING_TEXT_KEYS = ["clarifyText", "clarifySuggestions", "followupSuggestions"] as const;

export async function saveTuning(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const defaults = settingsSchema.tuning.parse({});
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(defaults)) {
      if ((TUNING_TEXT_KEYS as readonly string[]).includes(key)) continue;
      const raw = text(f, key).replace(",", ".");
      next[key] = raw === "" ? defaults[key as keyof typeof defaults] : Number(raw);
    }
    const lines = (k: string) => text(f, k).split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 10);
    await saveSettings("tuning", {
      ...(next as Settings<"tuning">),
      clarifyText: text(f, "clarifyText"),
      clarifySuggestions: lines("clarifySuggestions"),
      followupSuggestions: lines("followupSuggestions"),
    });
    return done("Параметры сохранены — применяются сразу (значения вне допустимых пределов заменены на стандартные)");
  } catch (e) {
    return fail(e);
  }
}

export async function resetTuning(): Promise<ActionState> {
  await requireAdmin();
  try {
    await saveSettings("tuning", settingsSchema.tuning.parse({}));
    return done("Параметры возвращены к значениям по умолчанию — обновите страницу");
  } catch (e) {
    return fail(e);
  }
}

export async function saveMap(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const old = await getSettings("map");
    const provider = text(f, "provider") === "yandex" ? "yandex" : "osm";
    const yandexKey = secret(f, "yandexKey", old.yandexKey);
    await saveSettings("map", { provider, yandexKey });
    return done(provider === "yandex" && !yandexKey ? "Сохранено, но без ключа показывается OpenStreetMap" : "Настройки карты сохранены");
  } catch (e) {
    return fail(e);
  }
}

export async function loadDemo(): Promise<ActionState> {
  await requireAdmin();
  try {
    return done(`Загружено тестовых событий: ${await seedDemo(db)}`);
  } catch (e) {
    return fail(e);
  }
}

export async function removeDemo(): Promise<ActionState> {
  await requireAdmin();
  try {
    return done(`Удалено тестовых событий: ${await clearDemo(db)}`);
  } catch (e) {
    return fail(e);
  }
}

export async function logout() {
  await requireAdmin("MODERATOR");
  await signOut();
  redirect("/admin/login");
}

// ── Пользователи админки (только ADMIN) ──────────────────────────────────────

const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Почта из формы: пусто — null; занята другим пользователем — ошибка. */
async function emailFrom(f: FormData, exceptId?: string) {
  const email = text(f, "email").toLowerCase();
  if (!email) return null;
  if (!EMAIL_RE.test(email) || email.length > 254) throw new Error("Почта указана неверно.");
  const other = await db.adminUser.findUnique({ where: { email } });
  if (other && other.id !== exceptId) throw new Error(`Почта ${email} уже у пользователя ${other.login}.`);
  return email;
}
const role = (f: FormData): AdminRole => (text(f, "role") === "ADMIN" ? "ADMIN" : "MODERATOR");

/** Нельзя оставить систему без активного администратора. */
async function assertAnotherAdmin(exceptId: string) {
  const n = await db.adminUser.count({ where: { role: "ADMIN", active: true, id: { not: exceptId } } });
  if (!n) throw new Error("Должен остаться хотя бы один активный администратор.");
}

function userDone(message: string): ActionState {
  revalidatePath("/admin/users");
  return { ok: true, message };
}

export async function createUser(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const login = text(f, "login").toLowerCase();
    if (!LOGIN_RE.test(login)) throw new Error("Логин: 3–32 символа, латиница в нижнем регистре, цифры, точка, дефис, подчёркивание.");
    if (await db.adminUser.findUnique({ where: { login } })) throw new Error(`Логин «${login}» уже занят.`);
    const email = await emailFrom(f);
    const invite = flag(f, "invite") && !!email && (await mailReady());
    const given = invite ? "" : text(f, "password");
    if (given && given.length < MIN_PASSWORD_LENGTH) throw new Error(`Пароль — не короче ${MIN_PASSWORD_LENGTH} символов.`);
    const password = given || generatePassword();
    const r = role(f);
    const user = await db.adminUser.create({ data: { login, email, name: text(f, "name") || null, role: r, passwordHash: await hashPassword(password) } });
    if (invite && email) {
      // Пароль задаёт сам пользователь по ссылке из письма; сгенерированный нигде не показывается
      const t = mailTemplates.invite(login, await createAdminToken(user.id, "invite"));
      await sendMail(email, t.subject, t.text);
      return userDone(`Пользователь ${login} (${ROLE_LABELS[r]}) создан, приглашение отправлено на ${email}.`);
    }
    return userDone(given ? `Пользователь ${login} (${ROLE_LABELS[r]}) создан.` : `Пользователь ${login} (${ROLE_LABELS[r]}) создан. Пароль: ${password} — сохраните, больше он не показывается.`);
  } catch (e) {
    return fail(e);
  }
}

export async function updateUser(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  try {
    const id = text(f, "id");
    const user = await db.adminUser.findUniqueOrThrow({ where: { id } });
    const r = role(f);
    const active = flag(f, "active");
    if (id === me.id && (r !== "ADMIN" || !active)) throw new Error("Свою роль и доступ изменить нельзя — попросите другого администратора.");
    if (user.role === "ADMIN" && (r !== "ADMIN" || !active)) await assertAnotherAdmin(id);
    await db.$transaction([
      db.adminUser.update({ where: { id }, data: { name: text(f, "name") || null, email: await emailFrom(f, id), role: r, active, failedLogins: 0, lockedUntil: null } }),
      // Отключённый пользователь выходит сразу
      ...(active ? [] : [db.adminSession.deleteMany({ where: { userId: id } })]),
    ]);
    return userDone(`Пользователь ${user.login} сохранён.`);
  } catch (e) {
    return fail(e);
  }
}

export async function resetUserPassword(id: string): Promise<ActionState> {
  await requireAdmin();
  try {
    const password = generatePassword();
    const user = await db.adminUser.update({ where: { id }, data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } });
    await dropSessions(id);
    await sendMailQuietly(user.email, mailTemplates.passwordChanged(user.login));
    return userDone(`Новый пароль ${user.login}: ${password} — сохраните, больше он не показывается. Все сессии пользователя закрыты.`);
  } catch (e) {
    return fail(e);
  }
}

export async function changeOwnPassword(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    const password = text(f, "password");
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Пароль — не короче ${MIN_PASSWORD_LENGTH} символов.`);
    if (password !== text(f, "password2")) throw new Error("Пароли не совпадают.");
    const user = await db.adminUser.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } });
    await sendMailQuietly(user.email, mailTemplates.passwordChanged(user.login));
    return userDone("Пароль изменён.");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteUser(id: string): Promise<ActionState> {
  const me = await requireAdmin();
  try {
    if (id === me.id) throw new Error("Себя удалить нельзя.");
    const user = await db.adminUser.findUniqueOrThrow({ where: { id } });
    if (user.role === "ADMIN") await assertAnotherAdmin(id);
    await db.adminUser.delete({ where: { id } });
    return userDone(`Пользователь ${user.login} удалён.`);
  } catch (e) {
    return fail(e);
  }
}

/** Для подсказок в форме: какие значения сейчас приходят из .env. */
export async function envFallbacks() {
  await requireAdmin();
  return {
    gigachat: !!process.env.GIGACHAT_AUTH_KEY,
    llm: !!process.env.LLM_API_URL,
    maxToken: !!process.env.MAX_BOT_TOKEN,
    tgToken: !!process.env.TELEGRAM_BOT_TOKEN,
    aiProviderEnv: process.env.AI_PROVIDER ?? "",
    gigachatModelEnv: pick("", process.env.GIGACHAT_MODEL),
  };
}

/** Письмо со ссылкой для нового пароля — вместо показа пароля администратору. */
export async function sendUserResetLink(id: string): Promise<ActionState> {
  await requireAdmin();
  try {
    const user = await db.adminUser.findUniqueOrThrow({ where: { id } });
    if (!user.email) throw new Error("У пользователя не указана почта.");
    const t = mailTemplates.reset(user.login, await createAdminToken(user.id, "reset"));
    await sendMail(user.email, t.subject, t.text);
    return userDone(`Ссылка для нового пароля отправлена на ${user.email}. Действует 1 час.`);
  } catch (e) {
    return fail(e);
  }
}

export async function saveOwnEmail(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    const email = await emailFrom(f, me.id);
    await db.adminUser.update({ where: { id: me.id }, data: { email } });
    revalidatePath("/admin/profile");
    return { ok: true, message: email ? `Почта сохранена: ${email}` : "Почта удалена — восстановить пароль по почте будет нельзя." };
  } catch (e) {
    return fail(e);
  }
}

// ── Почта (SMTP) ─────────────────────────────────────────────────────────────

export async function saveMail(_: ActionState, f: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const old = await getSettings("mail");
    await saveSettings("mail", {
      enabled: flag(f, "enabled"),
      host: text(f, "host"),
      port: Number(text(f, "port") || 2525),
      secure: flag(f, "secure"),
      user: text(f, "user"),
      password: secret(f, "password", old.password),
      from: text(f, "from").toLowerCase(),
      fromName: text(f, "fromName"),
      relayUrl: text(f, "relayUrl"),
      relaySecret: secret(f, "relaySecret", old.relaySecret),
    });
    return done("Настройки почты сохранены");
  } catch (e) {
    return fail(e);
  }
}

export async function testMail(): Promise<ActionState> {
  const me = await requireAdmin();
  try {
    const user = await db.adminUser.findUniqueOrThrow({ where: { id: me.id } });
    if (!user.email) throw new Error("Укажите свою почту в «Моём профиле» — тестовое письмо придёт на неё.");
    const t = mailTemplates.test();
    await sendMail(user.email, t.subject, t.text);
    return { ok: true, message: `Письмо отправлено на ${user.email}` };
  } catch (e) {
    return fail(e);
  }
}
