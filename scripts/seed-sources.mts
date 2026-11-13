// Начальный список источников (docs/DATA_SOURCES.md, раздел 3.1): npm run sources:seed [-- --allow-remote]
// Добавляет выключенными — модератор включает каждый в админке («Источники») после проверки.
// Уже существующие (по коду) не трогает.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !process.argv.includes("--allow-remote")) {
  console.error("Отказ: база не локальная. Для сервера добавьте --allow-remote.");
  process.exit(1);
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const SOURCES = [
  { code: "sgtko", name: "СГТКО — афиша (RSS)", url: "https://sgtko.ru/afisha/feed/", city: "Стерлитамак", note: "Лента даёт ссылки и описания; расписание и цены — в карточках" },
  { code: "bashgf", name: "Башкирская филармония — афиша (RSS)", url: "https://bashgf.ru/afisha/feed/", city: "Уфа", note: "Лента даёт ссылки и описания; расписание и цены — в карточках" },
  { code: "kudaufa", name: "КудаУфа (RSS)", url: "https://kudaufa.ru/rss/", city: "Уфа", note: "Агрегатор: сверять с учреждением. pubDate — не дата мероприятия" },
  { code: "museumrb", name: "Национальный музей РБ — выставки и события (RSS)", url: "https://museumrb.ru/category/vystavki-i-sobitia/feed/", city: "Уфа", note: "Дата новости — не начало выставки" },
  { code: "kulturarb", name: "Культурный мир Башкортостана — афиша (RSS)", url: "https://www.kulturarb.ru/ru/afisha/rss/afisha/afisha?format=feed", city: null, note: "Месячные планы учреждений, часть — изображениями; для обнаружения источников" },
];

let added = 0;
for (const s of SOURCES) {
  const exists = await db.source.findUnique({ where: { code: s.code } });
  if (exists) continue;
  await db.source.create({ data: { ...s, kind: "rss_ai", enabled: false, intervalHours: 12, maxItems: 10, createdBy: "seed" } });
  added++;
}
console.log(`Источников добавлено: ${added} (выключены — включите в админке после проверки)`);
await db.$disconnect();
