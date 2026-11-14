// Сверка карточки со страницей источника (lib/server/afisha-accuracy.ts): npm run test:accuracy
// Ошибки, встречавшиеся при импорте: неверное время/дата, чужая цена, отмена на странице, неверный город.
import "dotenv/config";
import assert from "node:assert/strict";
import { categorizeChange, categorizeImportError, checkCard, priceOnPage } from "../lib/server/afisha-accuracy.ts";
import { genreTagsFromUrl } from "../lib/server/normalize.ts";

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

const page = `<html><body><h1>Спектакль «Женитьба»</h1><p>Уфа, Русский драмтеатр</p>
  <div class="date">15 ноября, 19:00</div><div class="price">от 1 500 ₽</div></body></html>`;
const card = { title: "Женитьба", startsAt: new Date("2026-11-15T19:00:00+05:00"), endsAt: null, priceMin: 1500, city: "Уфа" };

check("карточка совпадает со страницей", () => assert.deepEqual(checkCard(card, page), { problems: [], warnings: [] }));
check("неверное время ловится", () => assert.deepEqual(checkCard({ ...card, startsAt: new Date("2026-11-15T18:00:00+05:00") }, page).problems, ["время"]));
check("перенос даты ловится", () => assert.deepEqual(checkCard({ ...card, startsAt: new Date("2026-11-16T19:00:00+05:00") }, page).problems, ["дата"]));
check("чужая цена ловится, 1 500 и 1500 — одно число", () => {
  assert.deepEqual(checkCard({ ...card, priceMin: 700 }, page).problems, ["цена"]);
  assert.ok(priceOnPage(1500, "от 1 500 ₽") && priceOnPage(1500, "1500 р.") && !priceOnPage(150, "1500 р."));
});
check("другое название ловится, порядок слов и кавычки не важны", () => {
  assert.deepEqual(checkCard({ ...card, title: "Ревизор" }, page).problems, ["название"]);
  assert.deepEqual(checkCard({ ...card, title: "«Женитьба», спектакль" }, page).problems, []);
});
check("название длиннее заголовка страницы (лента добавила программу) — совпадение", () => {
  const html = `<html><head><title>Ансамбль «Забава» &#8212; Филармония</title></head><body><p>20 ноября, 19:00</p></body></html>`;
  const c = { title: "Ансамбль «Забава» с программой «Там, где поёт душа»", startsAt: new Date("2026-11-20T19:00:00+05:00"), endsAt: null, priceMin: null, city: "" };
  assert.deepEqual(checkCard(c, html).problems, []);
  assert.deepEqual(checkCard({ ...c, title: "Хор «Радуга»" }, html).problems, ["название"]);
});
check("неверный город — предупреждение", () => assert.deepEqual(checkCard({ ...card, city: "Салават" }, page).warnings, ["город не упомянут на странице"]));
check("отмена на странице — предупреждение для метрики 11", () => {
  assert.ok(checkCard(card, page.replace("</h1>", "</h1><p>Спектакль отменён по болезни актёра</p>")).warnings.some((w) => w.includes("отменено")));
});
check("выставка: достаточно даты окончания, время не проверяется", () => {
  const exhibition = { ...card, title: "Женитьба", startsAt: new Date("2026-09-01T10:00:00+05:00"), endsAt: new Date("2026-11-15T18:00:00+05:00"), priceMin: null };
  assert.deepEqual(checkCard(exhibition, page).problems, []);
});
check("сеанс кино: дата и время в атрибутах страницы", () => {
  const html = `<div data-date="2026-11-14"><div class="movie-session-time">21:40</div></div><div class="movies-tile-title">Лиля</div>`;
  assert.deepEqual(checkCard({ title: "Лиля", startsAt: new Date("2026-11-14T21:40:00+05:00"), endsAt: null, priceMin: null, city: "" }, html).problems, []);
});
check("категории ошибок импорта и конфликтов", () => {
  assert.equal(categorizeImportError("вне Башкортостана: «Самара»"), "неверный город или регион");
  assert.equal(categorizeImportError("событие уже прошло"), "дата");
  assert.equal(categorizeChange({ startsAt: "2026-11-20" }), "изменение даты");
  assert.equal(categorizeChange({ address: "ул. Ленина, 1" }), "место: адрес, город, площадка");
  assert.equal(categorizeChange({ priceMin: 500 }), "конфликт сведений (цена, возраст, описание)");
});

check("поджанр из адреса официальной страницы театра", () => {
  assert.deepEqual(genreTagsFromUrl("https://bashopera.ru/repertoire/ballet/278/"), ["балет"]);
  assert.deepEqual(genreTagsFromUrl("https://bashopera.ru/repertoire/opera/15866/"), ["опера"]);
  assert.deepEqual(genreTagsFromUrl("https://bashopera.ru/repertoire/operetta/12/"), ["оперетта"]);
  assert.deepEqual(genreTagsFromUrl("https://example.org/news/opera-house-renovation"), []);
  assert.deepEqual(genreTagsFromUrl(null), []);
});

console.log(failed ? `Не прошло: ${failed}` : "Все проверки прошли");
process.exit(failed ? 1 : 0);
