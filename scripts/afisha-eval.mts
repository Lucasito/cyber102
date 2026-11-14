// Точность самой афиши (ТЗ 9.2, метрики 10–11): npm run eval:afisha [-- --sample 50] [-- --allow-remote]
// Сверяет опубликованные карточки с источниками, считает дубли и ошибки импорта за неделю → eval/afisha-report.md.
// В продакшне то же самое — кнопка «Проверить точность сейчас» на странице «Качество» админки.
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { accuracyMarkdown, measureAfishaAccuracy } from "../lib/server/afisha-accuracy.ts";
import { db } from "../lib/server/db.ts";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !process.argv.includes("--allow-remote")) {
  console.error("Отказ: база не локальная. Для сервера добавьте --allow-remote.");
  process.exit(1);
}
const i = process.argv.indexOf("--sample");
const sample = i > 0 ? Number(process.argv[i + 1]) || 50 : 50;
const r = await measureAfishaAccuracy({ sample });
await writeFile(new URL("../eval/afisha-report.md", import.meta.url), accuracyMarkdown(r));
console.log(`Точность ${r.accurate}/${r.checked}, не загрузилось ${r.unverified}, дублей ${r.duplicates.extra}/${r.duplicates.events}, отменённых как актуальные ${r.cancelledShown.length} → eval/afisha-report.md`);
await db.$disconnect();
