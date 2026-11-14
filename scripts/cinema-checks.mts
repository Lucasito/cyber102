// Проверка парсеров кинотеатров (lib/server/collect/cinemas.ts): npm run test:cinemas [-- --live] [-- --dir <папка>]
//  без ключей — правила дат и строк импорта;
//  --live — загрузить расписания с официальных сайтов и показать, сколько сеансов разобрано (структура сайта
//           поменялась — у парсера будет 0 сеансов или ошибка);
//  --dir — разобрать сохранённые страницы <код>.html из папки (для отладки без сети).
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { CINEMA_ADAPTERS, cityFromAddress, dayFromWords, parseArsenal, parseCinemaPark, parseMirage, parseP24, parsePremierzal, parseRodina, parseUltra, sessionRows, sessionStart, type Session } from "../lib/server/collect/cinemas.ts";

let failed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : e}`);
  }
};

check("ночной сеанс относится к следующему календарному дню", () => {
  assert.equal(sessionStart("2026-11-14", "00:30").toISOString(), "2026-11-14T19:30:00.000Z");
  assert.equal(sessionStart("2026-11-14", "19:00").toISOString(), "2026-11-14T14:00:00.000Z");
});
check("дата словами: «14 ноября», переход года", () => {
  assert.equal(dayFromWords("Суббота 14 ноября", new Date("2026-11-14T10:00:00+05:00")), "2026-11-14");
  assert.equal(dayFromWords("2 января", new Date("2026-12-30T10:00:00+05:00")), "2027-01-02");
  assert.equal(dayFromWords("15 мая", new Date("2026-05-01T10:00:00+05:00")), "2026-05-15");
});
check("строки импорта: категория кино, без прошедших и повторов", () => {
  const now = new Date("2026-11-14T12:00:00+05:00");
  const base: Session = { id: "1", title: " Фильм ", date: "2026-11-14", time: "19:00", sourceUrl: "https://example.org/s", price: 350, age: 12, format: "2D", hall: "Зал 1" };
  const rows = sessionRows("t", [base, { ...base }, { ...base, id: "2", time: "10:00" }, { ...base, id: "3", time: "01:10" }], now);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].title, rows[0].dateStart, rows[0].category, rows[0].priceMin, rows[0].ageLimit, rows[0].externalId], ["Фильм", "2026-11-14T19:00:00+05:00", "cinema", 350, 12, "t:1"]);
  assert.equal(rows[1].dateStart, "2026-11-15T01:10:00+05:00");
});

check("город из адреса кинотеатра", () => {
  assert.equal(cityFromAddress('г. Уфа, ул. Ферина, д. 29, ТЦ "Акварин"'), "Уфа");
  assert.equal(cityFromAddress("г. Стерлитамак, ул. Худайбердина 120, ТЦ Фабри, 4 этаж"), "Стерлитамак");
  assert.equal(cityFromAddress("Бузулук, ул. Ленина, 1"), "Бузулук");
  assert.equal(cityFromAddress("ул. Артема, 96"), null);
  assert.equal(cityFromAddress("ТЦ «Фабри»"), null);
});
check("сеансы кинотеатров сети вне Башкортостана отбрасываются, свой и другой кинотеатр РБ — остаются", () => {
  const now = new Date("2026-11-14T12:00:00+05:00");
  const base: Session = { id: "1", title: "Фильм", date: "2026-11-14", time: "19:00", sourceUrl: "https://example.org/s" };
  const rows = sessionRows("t", [
    { ...base, id: "ufa", venue: 'Синема 5 ТЦ "Акварин"', address: 'г. Уфа, ул. Ферина, д. 29' },
    { ...base, id: "buzuluk", venue: "Синема 5 Бузулук", address: "г. Бузулук, ул. Ленина, 1" },
    { ...base, id: "orenburg", venue: "Синема 5", address: "Оренбург, пр. Победы, 10" },
    { ...base, id: "str", venue: "Синема 5 Стерлитамак", address: "г. Стерлитамак, пр. Октября, 1" },
    { ...base, id: "noaddr" },
  ], now);
  assert.deepEqual(rows.map((r) => r.externalId), ["t:ufa", "t:str", "t:noaddr"]);
  assert.deepEqual([rows[0].venue, rows[0].city, rows[1].city, rows[2].city], ['Синема 5 ТЦ "Акварин"', "Уфа", "Стерлитамак", undefined]);
});

const dirArg = process.argv.indexOf("--dir");
if (dirArg > 0) {
  const dir = process.argv[dirArg + 1];
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Yekaterinburg" });
  const files: [string, (html: string) => Session[]][] = [
    ["kinoport", (h) => parsePremierzal(h, "https://kino-str.ru/schedule")],
    ["kino-rodina-ufa", (h) => parseRodina(h, "https://rodina-ufa.ru/")],
    ["kino-ultra-bakalinskaya", (h) => parseUltra(h, "https://ufa.ultra-cinema.ru/", day)],
    ["kino-cinemapark-galereya", (h) => parseCinemaPark(h, "https://kinoteatr.ru/raspisanie-kinoteatrov/ufa/galereya-art/", day)],
    ["kino-mirage-str", (h) => parseMirage(h, "https://www.mirage.ru/str/schedule/", day)],
    ["kino-mirkino-belebey", (h) => parseP24(h, "https://mirkino-belebey.ru/")],
    ["kino-arsenal-neftekamsk", (h) => parseArsenal(h, "https://arsenal-club.com/")],
  ];
  for (const [code, parse] of files) {
    const path = `${dir}/${code}.html`;
    if (!existsSync(path)) continue;
    const s = parse(readFileSync(path, "utf8"));
    const empty = s.filter((x) => !x.title || !x.time);
    console.log(`${code}: ${s.length} сеансов, ${new Set(s.map((x) => x.title)).size} фильмов${empty.length ? `, без названия/времени: ${empty.length}` : ""}`);
    if (s[0]) console.log("   ", JSON.stringify({ ...s[0], description: undefined }));
  }
}

if (process.argv.includes("--live")) {
  const SITES: [keyof typeof CINEMA_ADAPTERS, string][] = [
    ["cinema-premierzal", "https://kino-str.ru/schedule"],
    ["cinema-premierzal", "https://fountain-okt.ru/schedule"],
    ["cinema-premierzal", "https://metallurg-cinema.ru/schedule"],
    ["cinema-rodina", "https://rodina-ufa.ru/"],
    ["cinema-ultra", "https://ufa.ultra-cinema.ru/"],
    ["cinema-ultra", "https://mir.ultra-cinema.ru/"],
    ["cinema-cinemapark", "https://kinoteatr.ru/raspisanie-kinoteatrov/ufa/galereya-art/"],
    ["cinema-cinemapark", "https://kinoteatr.ru/raspisanie-kinoteatrov/ufa/semya/"],
    ["cinema-mirage", "https://www.mirage.ru/str/schedule/"],
    ["cinema-p24", "https://mirkino-belebey.ru/"],
    ["cinema-cinemabox", "https://cinema5.ru/ufa"],
    ["cinema-arsenal", "https://arsenal-club.com/"],
  ];
  for (const [adapter, url] of SITES) {
    const t = Date.now();
    try {
      const rows = await CINEMA_ADAPTERS[adapter].run(url);
      const days = new Set(rows.map((r) => String(r.dateStart).slice(0, 10)));
      const noPrice = rows.filter((r) => r.priceMin == null).length;
      console.log(`${rows.length ? "ok  " : "ZERO"} ${url}: ${rows.length} сеансов, ${new Set(rows.map((r) => r.title)).size} фильмов, дней ${days.size}, без цены ${noPrice} (${Math.round((Date.now() - t) / 1000)} с)`);
      if (!rows.length) failed++;
    } catch (e) {
      failed++;
      console.log(`FAIL ${url}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

console.log(failed ? `Не прошло: ${failed}` : "Все проверки прошли");
process.exit(failed ? 1 : 0);
