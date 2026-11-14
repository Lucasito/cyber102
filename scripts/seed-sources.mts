// Начальный список источников (docs/DATA_SOURCES.md): 5 RSS-лент и 10 страниц без RSS: npm run sources:seed [-- --allow-remote]
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

/** Без RSS: разметка schema.org (ИИ не нужен) и обычные страницы афиши (разбор ИИ, через модерацию). */
const PAGES = [
  { code: "afisha-ufa", kind: "jsonld", name: "Афиша Уфы (schema.org)", url: "https://afisha-ufa.ru/", city: "Уфа", note: "Агрегатор: сверять с учреждением" },
  { code: "rusdram", kind: "jsonld", name: "Русский драмтеатр РБ (schema.org)", url: "https://rusdram.ru/", city: "Уфа", note: "JSON-LD TheaterEvent на главной" },
  { code: "bashopera", kind: "html_ai", name: "Театр оперы и балета — афиша", url: "https://bashopera.ru/affiche/", city: "Уфа", note: "Гастроли — отдельно" },
  { code: "bashdram", kind: "html_ai", name: "Башдрамтеатр им. Гафури — афиша", url: "https://bashdram.ru/afisha/", city: "Уфа", note: "Есть выездные показы (Ишимбай)" },
  { code: "teatrnmt", kind: "html_ai", name: "Молодёжный театр им. Мустая Карима — афиша", url: "https://teatrnmt.ru/afisha/", city: "Уфа", note: null },
  { code: "teatrnur", kind: "html_ai", name: "Театр «Нур» — афиша", url: "https://teatrnur.ru/afisa", city: "Уфа", note: "Спектакли на татарском с синхронным переводом" },
  { code: "rusdramteatr", kind: "html_ai", name: "Русский драмтеатр Стерлитамака — афиша", url: "https://rusdramteatr.ru/", city: "Стерлитамак", note: null },
  { code: "sibaidram", kind: "html_ai", name: "Сибайский театр — афиша", url: "https://sibaidramteatr.ru/afisha.php", city: "Сибай", note: "Время в формате 14.00; гастроли" },
  { code: "gasorb", kind: "html_ai", name: "Госоркестр РБ — афиша", url: "https://gasorb.ru/affiche/", city: "Уфа", note: "Концерты в разных городах — город из текста записи, иначе Уфа" },
  { code: "ufa-lib", kind: "html_ai", name: "Библиотеки Уфы — анонсы", url: "https://ufa-lib.ru/anonsy", city: "Уфа", note: "Цена и возраст обычно не указаны" },
];

let added = 0;
for (const s of SOURCES) {
  const exists = await db.source.findUnique({ where: { code: s.code } });
  if (exists) continue;
  await db.source.create({ data: { ...s, kind: "rss_ai", enabled: false, intervalHours: 12, collectAt: "06:00", maxItems: 10, createdBy: "seed" } });
  added++;
}
for (const s of PAGES) {
  if (await db.source.findUnique({ where: { code: s.code } })) continue;
  await db.source.create({ data: { ...s, enabled: false, intervalHours: s.kind === "jsonld" ? 6 : 24, collectAt: "06:00", maxItems: 20, createdBy: "seed" } });
  added++;
}
console.log(`Источников добавлено: ${added} (выключены — включите в админке после проверки)`);
await db.$disconnect();
