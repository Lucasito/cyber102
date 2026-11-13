// Собрать источники сейчас (как кнопка «Собрать сейчас»): npm run sources:run [-- код1 код2] [-- --allow-remote]
// Без кодов — все включённые. Пишет итог каждого источника.
// Запускается с --conditions=react-server, чтобы пакет server-only не мешал вне Next.
import "dotenv/config";
import { runSource } from "../lib/server/collect/index.ts";
import { db } from "../lib/server/db.ts";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !process.argv.includes("--allow-remote")) {
  console.error("Отказ: база не локальная. Для сервера добавьте --allow-remote.");
  process.exit(1);
}
const codes = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const sources = await db.source.findMany({ where: codes.length ? { code: { in: codes } } : { enabled: true }, orderBy: { name: "asc" } });
if (!sources.length) console.log("Нет источников для сбора");
for (const s of sources) {
  try {
    const r = await runSource(s.id, "сборщик (вручную)");
    console.log(`${s.code}: ${r.message}`);
  } catch (e) {
    console.log(`${s.code}: ошибка — ${e instanceof Error ? e.message : e}`);
  }
}
await db.$disconnect();
process.exit(0);
