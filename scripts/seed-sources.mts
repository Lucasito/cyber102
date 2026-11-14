// Начальный список источников (docs/DATA_SOURCES.md, docs/CINEMA_SOURCES.md): 5 RSS-лент, 10 страниц без RSS
// и 14 кинотеатров: npm run sources:seed [-- --allow-remote]
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

/**
 * Кинотеатры (docs/CINEMA_SOURCES.md): страницы расписания, разбор ИИ через модерацию. Все сеансы — в одном здании,
 * поэтому площадка задана в источнике. Не добавлены: Киномакс «Планета» (CAPTCHA — не обходим) и «Горняк»
 * в Кумертау (регулярного расписания на сайте нет).
 */
const CINEMAS = [
  { code: "kino-mirage-str", name: "Мираж Синема, Стерлитамак — расписание", url: "https://www.mirage.ru/str/schedule/", city: "Стерлитамак", venueName: "Мираж Синема", venueAddress: null, note: "Различать обычные и льготные цены, сеансы после полуночи. Лучше — индивидуальный парсер" },
  { code: "kino-kinoport-str", name: "Кинопорт, Стерлитамак — расписание", url: "https://kino-str.ru/schedule", city: "Стерлитамак", venueName: "Кинопорт", venueAddress: null, note: "При проверке — цикл перенаправлений: сначала проверить загрузку («Проверить»)" },
  { code: "kino-arsenal-neftekamsk", name: "Кинотеатр «Арсенал», Нефтекамск", url: "https://arsenal-club.com/", city: "Нефтекамск", venueName: "Кинотеатр «Арсенал»", venueAddress: "Комсомольский проспект, 27Б", note: "Есть JSON-LD — проверить, описывает ли он сеансы (тогда тип «schema.org»)" },
  { code: "kino-fontan-okt", name: "Кинотеатр «Фонтан», Октябрьский", url: "https://fountain-okt.ru/schedule", city: "Октябрьский", venueName: "Кинотеатр «Фонтан»", venueAddress: "проспект Ленина, 16", note: "При проверке — цикл перенаправлений" },
  { code: "kino-metallurg-beloretsk", name: "Кинотеатр «Металлург», Белорецк", url: "https://metallurg-cinema.ru/schedule", city: "Белорецк", venueName: "Кинотеатр «Металлург»", venueAddress: "ул. Карла Маркса, 70А", note: "При проверке — цикл перенаправлений" },
  { code: "kino-avrora-birsk", name: "КРК «Аврора», Бирск — кино", url: "https://kinowidget.kinoplan.ru/1830", city: "Бирск", venueName: "КРК «Аврора»", venueAddress: "ул. Интернациональная, 159Д", note: "Расписание — виджет Киноплана (страница krkavrora.ru/kino); может требовать JS" },
  { code: "kino-mirkino-belebey", name: "Кинотеатр «Мир кино», Белебей", url: "https://mirkino-belebey.ru/", city: "Белебей", venueName: "Кинотеатр «Мир кино»", venueAddress: "ул. Ленина, 28", note: "Сеансы, возраст и цены в HTML" },
  { code: "kino-super8-tuymazy", name: "Кинотеатр «Супер 8», Туймазы", url: "https://xn--80aoem2ag4d.xn--8-itb3afcm.xn--p1ai/", city: "Туймазы", venueName: "Кинотеатр «Супер 8»", venueAddress: "ул. Чапаева, 69", note: "Проверить выбор даты и актуальность сеансов" },
  { code: "kino-rodina-ufa", name: "Кинотеатр «Родина», Уфа", url: "https://rodina-ufa.ru/", city: "Уфа", venueName: "Кинотеатр «Родина»", venueAddress: "ул. Ленина, 42", note: "Расписание, возраст и цены в HTML; есть JSON-LD — проверить тип" },
  { code: "kino-ultra-bakalinskaya", name: "Ultra Cinema (ТКЦ ULTRA), Уфа", url: "https://ufa.ultra-cinema.ru/", city: "Уфа", venueName: "Ultra Cinema, ТКЦ ULTRA", venueAddress: "ул. Бакалинская, 27", note: "Сеансы, залы, возраст и цены в HTML; общий парсер с «Ultra Cinema Мир»" },
  { code: "kino-ultra-mir", name: "Ultra Cinema (ЦТиР «Мир»), Уфа", url: "https://mir.ultra-cinema.ru/", city: "Уфа", venueName: "Ultra Cinema, ЦТиР «Мир»", venueAddress: "проспект Октября, 4/1", note: "Структура как у ufa.ultra-cinema.ru" },
  { code: "kino-cinema5-akvarin", name: "Синема 5 «Акварин», Уфа", url: "https://cinema5.ru/ufa", city: "Уфа", venueName: "Синема 5, ТЦ «Акварин»", venueAddress: "ул. Ферина, 29", note: "Сеансы, возраст, цены и тип зала в HTML" },
  { code: "kino-cinemapark-galereya", name: "Синема Парк «Галерея Арт», Уфа", url: "https://kinoteatr.ru/raspisanie-kinoteatrov/ufa/galereya-art/", city: "Уфа", venueName: "Синема Парк, ТРЦ «Галерея Арт»", venueAddress: "ул. Чернышевского, 75", note: "Расписание, залы, цены, возраст, форматы" },
  { code: "kino-cinemapark-semya", name: "Синема Парк «Семья», Уфа", url: "https://kinoteatr.ru/raspisanie-kinoteatrov/ufa/semya/", city: "Уфа", venueName: "Синема Парк, ТРК «Семья»", venueAddress: "проспект Октября, 34", note: "При проверке страница вернула 403" },
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
for (const s of CINEMAS) {
  if (await db.source.findUnique({ where: { code: s.code } })) continue;
  // Расписание кино меняется ежедневно; сеансов много — лимит выше, чем у театров
  await db.source.create({ data: { ...s, kind: "html_ai", enabled: false, intervalHours: 24, collectAt: "07:00", maxItems: 40, createdBy: "seed" } });
  added++;
}
console.log(`Источников добавлено: ${added} (выключены — включите в админке после проверки)`);
await db.$disconnect();
