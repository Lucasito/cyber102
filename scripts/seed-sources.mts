// Начальный список источников (docs/DATA_SOURCES.md, docs/CINEMA_SOURCES.md): 5 RSS-лент, 10 страниц без RSS
// и 12 кинотеатров: npm run sources:seed [-- --allow-remote] [-- --enable-cinemas]
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
 * Кинотеатры (docs/CINEMA_SOURCES.md): индивидуальные парсеры без ИИ (lib/server/collect/cinemas.ts), один сеанс —
 * одно событие. Все сеансы — в одном здании, поэтому площадка с координатами задана в источнике
 * (координаты — Nominatim по адресу, проверены по названию здания; «Мир кино» — с официального сайта). Не добавлены: Киномакс «Планета»
 * (CAPTCHA), «Горняк» (нет расписания на сайте), «Супер 8» и «Аврора» (сеансы только через JavaScript).
 */
const CINEMAS = [
  { code: "kino-mirage-str", adapter: "cinema-mirage", name: "Мираж Синема «Арбат», Стерлитамак", url: "https://www.mirage.ru/str/schedule/", city: "Стерлитамак", venueName: "Мираж Синема «Арбат»", venueAddress: "ул. Артёма, 96", venueLat: 53.6224809, venueLon: 55.9012368 },
  { code: "kino-kinoport-str", adapter: "cinema-premierzal", name: "Кинопорт, Стерлитамак", url: "https://kino-str.ru/schedule", city: "Стерлитамак", venueName: "Кинотеатр «Кинопорт»", venueAddress: "ул. Худайбердина, 120, ТЦ «Фабри»", venueLat: 53.6287254, venueLon: 55.9406118 },
  { code: "kino-arsenal-neftekamsk", adapter: "cinema-arsenal", name: "Кинотеатр «Арсенал», Нефтекамск", url: "https://arsenal-club.com/", city: "Нефтекамск", venueName: "Кинотеатр «Арсенал»", venueAddress: "Комсомольский проспект, 27Б", venueLat: 56.0868614, venueLon: 54.2453158 },
  { code: "kino-fontan-okt", adapter: "cinema-premierzal", name: "Кинотеатр «Фонтан», Октябрьский", url: "https://fountain-okt.ru/schedule", city: "Октябрьский", venueName: "Кинотеатр «Фонтан»", venueAddress: "проспект Ленина, 16", venueLat: 54.4822103, venueLon: 53.4717662 },
  { code: "kino-metallurg-beloretsk", adapter: "cinema-premierzal", name: "Кинотеатр «Металлург», Белорецк", url: "https://metallurg-cinema.ru/schedule", city: "Белорецк", venueName: "Кинотеатр «Металлург»", venueAddress: "ул. Карла Маркса, 70А", venueLat: 53.968176, venueLon: 58.4090368 },
  { code: "kino-mirkino-belebey", adapter: "cinema-p24", name: "Кинотеатр «Мир кино», Белебей", url: "https://mirkino-belebey.ru/", city: "Белебей", venueName: "Кинотеатр «Мир кино»", venueAddress: "ул. Ленина, 28", venueLat: 54.10425186, venueLon: 54.11124802 },
  { code: "kino-rodina-ufa", adapter: "cinema-rodina", name: "Кинотеатр «Родина», Уфа", url: "https://rodina-ufa.ru/", city: "Уфа", venueName: "Кинотеатр «Родина»", venueAddress: "ул. Ленина, 42", venueLat: 54.72809, venueLon: 55.9493302 },
  { code: "kino-ultra-bakalinskaya", adapter: "cinema-ultra", name: "Ultra Cinema (ТКЦ ULTRA), Уфа", url: "https://ufa.ultra-cinema.ru/", city: "Уфа", venueName: "Ultra Cinema, ТКЦ ULTRA", venueAddress: "ул. Бакалинская, 27", venueLat: 54.7173819, venueLon: 55.9847376 },
  { code: "kino-ultra-mir", adapter: "cinema-ultra", name: "Ultra Cinema (ЦТиР «Мир»), Уфа", url: "https://mir.ultra-cinema.ru/", city: "Уфа", venueName: "Ultra Cinema, ЦТиР «Мир»", venueAddress: "проспект Октября, 4/1", venueLat: 54.7413618, venueLon: 55.9850374 },
  { code: "kino-cinema5-akvarin", adapter: "cinema-cinemabox", name: "Синема 5 «Акварин», Уфа", url: "https://cinema5.ru/ufa", city: "Уфа", venueName: "Синема 5, ТЦ «Акварин»", venueAddress: "ул. Ферина, 29", venueLat: 54.7783861, venueLon: 56.1326648 },
  { code: "kino-cinemapark-galereya", adapter: "cinema-cinemapark", name: "Синема Парк «Галерея Арт», Уфа", url: "https://kinoteatr.ru/raspisanie-kinoteatrov/ufa/galereya-art/", city: "Уфа", venueName: "Синема Парк, ТРЦ «Галерея Арт»", venueAddress: "ул. Чернышевского, 75", venueLat: 54.7294178, venueLon: 55.9465453 },
  { code: "kino-cinemapark-semya", adapter: "cinema-cinemapark", name: "Синема Парк «Семья», Уфа", url: "https://kinoteatr.ru/raspisanie-kinoteatrov/ufa/semya/", city: "Уфа", venueName: "Синема Парк, ТРК «Семья»", venueAddress: "проспект Октября, 34", venueLat: 54.749679, venueLon: 56.0002227 },
];
/** Кинотеатры, которые раньше добавлялись этим скриптом как «страница + ИИ» и ещё не включались. */
const OLD_CINEMAS = ["kino-avrora-birsk", "kino-super8-tuymazy"];

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
let switched = 0;
for (const s of CINEMAS) {
  const note = "Индивидуальный парсер: сеансы на 5 дней с официального сайта, без ИИ";
  const exists = await db.source.findUnique({ where: { code: s.code } });
  // Добавленные раньше как «страница + ИИ» и не тронутые модератором — переводим на парсер
  if (exists?.createdBy === "seed" && exists.kind === "html_ai" && !exists.enabled && !exists.lastRunAt) {
    await db.source.update({ where: { id: exists.id }, data: { ...s, kind: "custom", note, intervalHours: 24, collectAt: "07:00" } });
    switched++;
  }
  // Координаты здания: у добавленных раньше без них — дописываем (адрес в источнике тот же)
  if (exists && exists.venueLat == null && exists.venueLon == null) {
    await db.source.update({ where: { id: exists.id }, data: { venueLat: s.venueLat, venueLon: s.venueLon, venueAddress: exists.venueAddress ?? s.venueAddress } });
  }
  if (exists) continue;
  // Расписание кино меняется ежедневно: сбор раз в сутки утром
  await db.source.create({ data: { ...s, kind: "custom", note, enabled: false, intervalHours: 24, collectAt: "07:00", maxItems: 20, createdBy: "seed" } });
  added++;
}
const removed = await db.source.deleteMany({ where: { code: { in: OLD_CINEMAS }, createdBy: "seed", enabled: false, lastRunAt: null } });
// --enable-cinemas: включить кинотеатры с автопубликацией (данные структурированы и берутся с официальных сайтов)
if (process.argv.includes("--enable-cinemas")) {
  const on = await db.source.updateMany({ where: { code: { in: CINEMAS.map((c) => c.code) }, kind: "custom" }, data: { enabled: true, autoPublish: true } });
  console.log(`Кинотеатров включено с автопубликацией: ${on.count}`);
}
if (switched || removed.count) console.log(`Кинотеатров переведено на парсеры: ${switched}, удалено несобираемых: ${removed.count}`);
console.log(`Источников добавлено: ${added} (выключены — включите в админке после проверки)`);
await db.$disconnect();
