// Пользователь админки из консоли — для первого входа и восстановления доступа.
//   npx tsx scripts/admin-user.mts <логин> [--role ADMIN|MODERATOR] [--name "Имя"]
// Пользователя нет — создаётся; есть — получает новый пароль, роль (если указана), снимается блокировка.
// Пароль генерируется и печатается один раз. На сервере:
//   docker exec afisha-app npx tsx scripts/admin-user.mts admin --role ADMIN
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type AdminRole } from "../generated/prisma/client.ts";
import { generatePassword, hashPassword, ROLE_LABELS } from "../lib/server/password.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const login = (args[0] ?? "").toLowerCase();
if (!/^[a-z0-9._-]{3,32}$/.test(login)) {
  console.error("Использование: npx tsx scripts/admin-user.mts <логин> [--role ADMIN|MODERATOR] [--name \"Имя\"]");
  process.exit(1);
}
const roleArg = opt("--role")?.toUpperCase();
if (roleArg && roleArg !== "ADMIN" && roleArg !== "MODERATOR") {
  console.error("Роль: ADMIN или MODERATOR");
  process.exit(1);
}
const role = roleArg as AdminRole | undefined;

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }) });
const password = generatePassword();
const passwordHash = await hashPassword(password);
const name = opt("--name");
const user = await db.adminUser.upsert({
  where: { login },
  create: { login, name: name ?? null, role: role ?? "ADMIN", passwordHash },
  update: { passwordHash, failedLogins: 0, lockedUntil: null, active: true, ...(role ? { role } : {}), ...(name ? { name } : {}) },
});
// Новый пароль закрывает все прежние сессии пользователя
await db.adminSession.deleteMany({ where: { userId: user.id } });
console.log(`Логин: ${user.login}\nРоль: ${ROLE_LABELS[user.role]}\nПароль: ${password}`);
await db.$disconnect();
