// Первый запуск в docker compose (локально, на чистой машине): тестовые события, если база пуста,
// и первый администратор, если пользователей нет (пароль печатается в лог один раз).
// Включается переменными BOOTSTRAP_DEMO=1 и BOOTSTRAP_ADMIN=1 — на продакшн-сервере они не заданы.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { seedDemo } from "../lib/demo-data.ts";
import { generatePassword, hashPassword } from "../lib/server/password.ts";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }) });
if (process.env.BOOTSTRAP_DEMO === "1" && (await db.event.count()) === 0) {
  console.log(`[bootstrap] база пуста — тестовые события: ${await seedDemo(db)}`);
}
if (process.env.BOOTSTRAP_ADMIN === "1" && (await db.adminUser.count()) === 0) {
  const password = generatePassword();
  await db.adminUser.create({ data: { login: "admin", name: "Администратор", role: "ADMIN", passwordHash: await hashPassword(password) } });
  console.log(`[bootstrap] администратор создан — вход: ${process.env.PUBLIC_URL ?? "http://localhost:3000"}/admin, логин admin, пароль ${password}`);
}
await db.$disconnect();
