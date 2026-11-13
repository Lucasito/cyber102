// Универсальный формат ленты событий для учреждений (страница /docs/format, образцы /docs/format/sample.json и .xml).
// Поля совпадают с импортом (lib/server/import.ts): лента читается тем же кодом, что загрузка файла в админке.

export type FormatField = { name: string; required: boolean; type: string; example: string; about: string };

export const FORMAT_FIELDS: FormatField[] = [
  { name: "externalId", required: false, type: "строка", example: "evt-2027-0314-1900", about: "Постоянный код события в вашей системе. С ним перенос даты обновит событие, а не создаст новое" },
  { name: "title", required: true, type: "строка, 3–300", example: "Вечер органной музыки", about: "Название без даты и цены" },
  { name: "dateStart", required: true, type: "дата и время ISO 8601", example: "2027-03-14T19:00:00+05:00", about: "Начало. Без часового пояса — время Уфы (UTC+5)" },
  { name: "dateEnd", required: false, type: "дата и время ISO 8601", example: "2027-03-14T21:00:00+05:00", about: "Окончание; у выставки — последний день" },
  { name: "city", required: true, type: "строка", example: "Уфа", about: "Населённый пункт Республики Башкортостан" },
  { name: "venue", required: true, type: "строка", example: "Концертный зал «Гармония»", about: "Площадка (зал, музей, ДК)" },
  { name: "address", required: false, type: "строка", example: "ул. Музыкальная, 5", about: "Адрес площадки — для карты и маршрута" },
  { name: "sourceUrl", required: true, type: "ссылка https", example: "https://example.org/afisha/organ-14-03", about: "Страница события на вашем сайте — ссылка на первоисточник в карточке" },
  { name: "priceMin", required: false, type: "число, ₽", example: "500", about: "Минимальная цена билета" },
  { name: "priceMax", required: false, type: "число, ₽", example: "1500", about: "Максимальная цена" },
  { name: "isFree", required: false, type: "true / false", example: "false", about: "Вход свободный" },
  { name: "ageLimit", required: false, type: "число", example: "6", about: "Возрастное ограничение: 0, 6, 12, 16, 18" },
  { name: "category", required: false, type: "код или название", example: "concert", about: "Жанр: theatre, concert, exhibition, museum, kids, cinema, festival, lecture, excursion" },
  { name: "description", required: false, type: "текст", example: "Бах, Букстехуде, Франк.", about: "Анонс, до 5000 символов" },
  { name: "ticketUrl", required: false, type: "ссылка https", example: "https://example.org/tickets/123", about: "Покупка билетов" },
  { name: "imageUrl", required: false, type: "ссылка https", example: "https://example.org/img/organ.jpg", about: "Афиша или фото" },
  { name: "status", required: false, type: "строка", example: "cancelled", about: "scheduled, rescheduled (перенесено), cancelled (отменено), sold_out (билетов нет)" },
  { name: "pushkin", required: false, type: "true / false", example: "true", about: "Можно оплатить Пушкинской картой" },
  { name: "tags", required: false, type: "строки через запятую", example: "орган, классика", about: "Метки для поиска" },
  { name: "language", required: false, type: "строка", example: "башкирский", about: "Язык мероприятия, если не русский" },
  { name: "durationMin", required: false, type: "число, мин", example: "120", about: "Длительность, если нет dateEnd" },
];

const sample = [
  {
    externalId: "evt-2027-0314-1900",
    title: "Вечер органной музыки",
    dateStart: "2027-03-14T19:00:00+05:00",
    dateEnd: "2027-03-14T21:00:00+05:00",
    city: "Уфа",
    venue: "Концертный зал «Гармония»",
    address: "ул. Музыкальная, 5",
    sourceUrl: "https://example.org/afisha/organ-14-03",
    priceMin: 500,
    priceMax: 1500,
    ageLimit: 6,
    category: "concert",
    description: "Бах, Букстехуде, Франк. Органистка — лауреат международных конкурсов.",
    ticketUrl: "https://example.org/tickets/123",
    pushkin: true,
  },
  {
    externalId: "exh-2027-03",
    title: "Выставка «Пейзаж Южного Урала»",
    dateStart: "2027-03-01T10:00:00+05:00",
    dateEnd: "2027-03-31T18:00:00+05:00",
    city: "Уфа",
    venue: "Художественная галерея",
    sourceUrl: "https://example.org/afisha/landscape",
    isFree: true,
    ageLimit: 0,
    category: "exhibition",
  },
];

export const SAMPLE_JSON = JSON.stringify({ events: sample }, null, 2);

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:afisha="urn:afisha-rb:1">
  <channel>
    <title>Афиша учреждения</title>
    <link>https://example.org/afisha</link>
    <description>События для афиши культуры Башкортостана</description>
${sample
  .map(
    (e) => `    <item>
      <guid isPermaLink="false">${e.externalId}</guid>
      <title>${xml(e.title)}</title>
      <link>${e.sourceUrl}</link>
      <description>${xml(e.description ?? "")}</description>
      <afisha:dateStart>${e.dateStart}</afisha:dateStart>
      <afisha:dateEnd>${e.dateEnd}</afisha:dateEnd>
      <afisha:city>${e.city}</afisha:city>
      <afisha:venue>${xml(e.venue)}</afisha:venue>${e.address ? `\n      <afisha:address>${xml(e.address)}</afisha:address>` : ""}${
        e.priceMin != null ? `\n      <afisha:priceMin>${e.priceMin}</afisha:priceMin>\n      <afisha:priceMax>${e.priceMax}</afisha:priceMax>` : `\n      <afisha:isFree>true</afisha:isFree>`
      }
      <afisha:ageLimit>${e.ageLimit}</afisha:ageLimit>
      <afisha:category>${e.category}</afisha:category>
    </item>`,
  )
  .join("\n")}
  </channel>
</rss>
`;
