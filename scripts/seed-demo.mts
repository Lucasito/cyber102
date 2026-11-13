// Тестовые события: npm run seed:demo  |  удалить: npm run seed:demo -- --clear
// Нелокальная база (сервер) — только с флагом --allow-remote. То же самое есть кнопкой в админке.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { clearDemo, seedDemo } from "../lib/demo-data.ts";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !process.argv.includes("--allow-remote")) {
  console.error("Отказ: база не локальная. Для сервера добавьте --allow-remote.");
  process.exit(1);
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
if (process.argv.includes("--clear")) console.log(`Удалено тестовых событий: ${await clearDemo(db)}`);
else console.log(`Тестовые события: ${await seedDemo(db)}`);
await db.$disconnect();
