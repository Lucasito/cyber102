// Интерфейс на русском и башкирском. Общий для серверных и клиентских компонентов.
// Башкирские тексты — перевод, требует проверки носителем языка.
// Содержимое событий (названия, площадки) не переводится — приходит из источников на русском.

export type Lang = "ru" | "ba";
export const LANGS: Lang[] = ["ru", "ba"];
export const LANG_COOKIE = "lang";

const D = {
  siteName: ["Афиша культуры Башкортостана", "Башҡортостан мәҙәниәте афишаһы"],
  siteShort: ["Афиша РБ", "БР афишаһы"],
  botsLabel: ["Помощник в мессенджере:", "Мессенджерҙағы ярҙамсы:"],
  botIn: ["Бот в", "Бот:"],
  footerReal: ["Только реальные события: у каждого есть ссылка на источник.", "Тик ысын саралар: һәр береһенең сығанағына һылтанма бар."],
  forDevs: ["Для разработчиков: API и виджет", "Эшләүселәр өсөн: API һәм виджет"],
  widgetBuilder: ["Виджет для сайта", "Сайт өсөн виджет"],
  forOrganizers: ["Учреждениям и организаторам", "Учреждениелар һәм ойоштороусылар өсөн"],
  feedbackLink: ["Организаторам и обратная связь", "Ойоштороусыларға һәм кире бәйләнеш"],
  reportError: ["Сообщить об ошибке или переносе", "Хата йәки күсереү тураһында хәбәр итергә"],
  adminLogin: ["Вход для администраторов", "Хакимдәр өсөн инеү"],
  heroTitle: ["Куда сходить в Башкортостане", "Башҡортостанда ҡайҙа барырға"],
  heroSubtitle: [
    "Спектакли, концерты, выставки и музеи республики. Опишите запрос своими словами — помощник подберёт события из афиши.",
    "Республиканың спектаклдәре, концерттары, күргәҙмәләре һәм музейҙары. Һорауығыҙҙы үҙ һүҙҙәрегеҙ менән яҙығыҙ — ярҙамсы афишанан саралар һайлап бирер.",
  ],
  allDates: ["Все даты", "Бөтә көндәр"],
  today: ["Сегодня", "Бөгөн"],
  tomorrow: ["Завтра", "Иртәгә"],
  weekend: ["Выходные", "Ял көндәре"],
  free: ["Бесплатно", "Түләүһеҙ"],
  withKids: ["С детьми", "Балалар менән"],
  pushkin: ["Пушкинская карта", "Пушкин картаһы"],
  access: ["Доступная среда", "Ҡулай мөхит"],
  nearMe: ["Рядом со мной", "Миңә яҡын"],
  geoUnsupported: ["Браузер не умеет определять местоположение", "Браузер урынды билдәләй алмай"],
  geoDenied: ["Не удалось определить местоположение — разрешите доступ в браузере", "Урынды билдәләп булманы — браузерҙа рөхсәт бирегеҙ"],
  moreFilters: ["Ещё фильтры", "Тағы фильтрҙар"],
  qPlaceholder: ["Название или площадка", "Исеме йәки урыны"],
  allCities: ["Все города", "Бөтә ҡалалар"],
  priceTo: ["Цена до, ₽", "Хаҡы, ₽ тиклем"],
  show: ["Показать", "Күрһәтергә"],
  found: ["Найдено", "Табылды"],
  upcoming: ["Ближайшие события", "Яҡындағы саралар"],
  reset: ["Сбросить", "Таҙартырға"],
  sortDate: ["По дате", "Көнө буйынса"],
  sortCheap: ["Сначала дешёвые", "Башта арзандары"],
  sortExpensive: ["Сначала дорогие", "Башта ҡиммәттәре"],
  sortNew: ["Новые в афише", "Афишала яңылары"],
  sortNear: ["Ближе ко мне", "Миңә яҡыныраҡ"],
  viewList: ["Списком", "Исемлек"],
  viewMap: ["На карте", "Картала"],
  showMore: ["Показать ещё", "Тағы күрһәтергә"],
  nothingFound: ["Ничего не нашлось", "Бер нәмә лә табылманы"],
  labelCity: ["Город", "Ҡала"],
  labelFrom: ["С даты", "Ошо көндән"],
  labelTo: ["По дату", "Ошо көнгә тиклем"],
  labelPrice: ["Цена до, ₽", "Хаҡ, ₽ тиклем"],
  relaxLead: ["Если снять одно условие, найдётся:", "Бер шартты алһаң, табыла:"],
  relaxDates: ["Без даты", "Көнһөҙ"],
  relaxCategory: ["Любая категория", "Теләһә ниндәй категория"],
  relaxCity: ["Все города", "Бөтә ҡалалар"],
  relaxPrice: ["Любая цена", "Теләһә ниндәй хаҡ"],
  relaxAge: ["Любой возраст", "Теләһә ниндәй йәш"],
  relaxQuery: ["Без поиска по словам", "Һүҙ буйынса эҙләүһеҙ"],
  relaxPushkin: ["Не только Пушкинская карта", "Пушкин картаһы ғына түгел"],
  relaxAccess: ["Без доступной среды", "Ҡулай мөхитһеҙ"],
  relaxNear: ["Не только рядом", "Яҡында ғына түгел"],
  nothingHint: ["Попробуйте другие даты или уберите часть фильтров.", "Башҡа көндәрҙе һайлап йәки ҡайһы бер фильтрҙарҙы алып ҡарағыҙ."],
  emptyAfisha: ["Афиша пока пуста", "Афиша әлегә буш"],
  emptyHint: ["События появятся после подключения источников.", "Саралар сығанаҡтар тоташтырылғас барлыҡҡа килер."],
  mapEmpty: ["Нет событий с адресом на карте под эти условия.", "Был шарттарға картала адреслы саралар юҡ."],
  badFilter: ["Неверные параметры фильтра.", "Фильтр параметрҙары дөрөҫ түгел."],
  // Чат
  assistant: ["Помощник афиши", "Афиша ярҙамсыһы"],
  typing: ["печатает…", "яҙа…"],
  assistantNote: ["подбирает события только из афиши", "сараларҙы тик афишанан һайлай"],
  locateMe: ["📍 Показать, где я", "📍 Ҡайҙа икәнемде күрһәт"],
  noLocation: ["Искать без местоположения", "Урынһыҙ эҙләргә"],
  degradedNote: ["ИИ сейчас недоступен — подборка сделана обычным поиском по вашим условиям.", "ЯИ хәҙер эшләмәй — һайлау шарттарығыҙ буйынса ғәҙәти эҙләү менән яһалды."],
  disclaimer: [
    "Неофициальный сервис: не является сайтом Министерства культуры Республики Башкортостан. События — из открытых источников, у каждого есть ссылка на источник.",
    "Рәсми булмаған хеҙмәт: Башҡортостан Республикаһы Мәҙәниәт министрлығы сайты түгел. Саралар — асыҡ сығанаҡтарҙан, һәр береһенең сығанағына һылтанма бар.",
  ],
  newChat: ["Новый разговор", "Яңы һөйләшеү"],
  askPlaceholder: ["Куда хотите сходить?", "Ҡайҙа барырға теләйһегеҙ?"],
  chatPlaceholder: ["Напишите сообщение…", "Хәбәр яҙығыҙ…"],
  send: ["Отправить", "Ебәрергә"],
  stage0: ["Разбираю запрос…", "Һорауҙы тикшерәм…"],
  stage1: ["Ищу события в афише…", "Афишанан саралар эҙләйем…"],
  stage2: ["Помощник сейчас отвечает другим — вы в очереди, ещё немного…", "Ярҙамсы хәҙер башҡаларға яуап бирә — һеҙ сиратта, бер аҙ көтөгөҙ…"],
  stage3: ["Запросов много, ответ почти готов…", "Һорауҙар күп, яуап тиҙҙән әҙер…"],
  seconds: ["с", "с"],
  aiDisabled: ["Умный поиск временно недоступен — воспользуйтесь фильтрами ниже.", "Аҡыллы эҙләү ваҡытлыса эшләмәй — түбәндәге фильтрҙарҙы ҡулланығыҙ."],
  aiFailed: ["Не получилось подобрать события.", "Саралар һайлап булманы."],
  netError: ["Ошибка сети — попробуйте ещё раз.", "Селтәр хатаһы — ҡабатлап ҡарағыҙ."],
  newSearch: ["Новый поиск", "Яңы эҙләү"],
  // Карточка и страница события
  live: ["идёт сейчас", "хәҙер бара"],
  liveUntil: ["идёт сейчас, до {time}", "хәҙер бара, {time} тиклем"],
  until: ["до", "тиклем"],
  otherSessions: ["Другие показы:", "Башҡа күрһәтеүҙәр:"],
  sessionsMany: ["{n} показов", "{n} күрһәтеү"],
  sessionsFew: ["{n} показа", "{n} күрһәтеү"],
  priceUnknown: ["Цена уточняется", "Хаҡы аныҡлана"],
  priceFrom: ["от {price} ₽", "{price} ₽-нан"],
  statusRescheduled: ["Перенесено", "Күсерелде"],
  statusCancelled: ["Отменено", "Кире ҡағылды"],
  statusSoldOut: ["Билетов нет", "Билеттар юҡ"],
  statusPast: ["Прошло", "Үтте"],
  allAfisha: ["Вся афиша", "Бөтә афиша"],
  buy: ["Купить билет", "Билет алырға"],
  ticketsPage: ["Страница билетов", "Билеттар бите"],
  toCalendar: ["В календарь", "Календарға"],
  share: ["Поделиться", "Бүлешергә"],
  copied: ["Ссылка скопирована", "Һылтанма күсерелде"],
  about: ["О событии", "Сара тураһында"],
  howToGet: ["Как добраться", "Нисек барырға"],
  route: ["Проложить маршрут в Яндекс Картах", "Яндекс Карталарында маршрут төҙөргә"],
  source: ["Источник:", "Сығанаҡ:"],
  more: ["Ещё:", "Тағы:"],
  untilTime: ["до {time}", "{time} тиклем"],
  noAge: ["Без возрастных ограничений", "Йәш сикләүҙәре юҡ"],
  ageFrom: ["Для зрителей от {age} лет", "{age} йәштән тамашасылар өсөн"],
  pushkinPay: ["Можно оплатить Пушкинской картой", "Пушкин картаһы менән түләргә мөмкин"],
  pushkinWho: ["Для молодёжи от 14 до 22 лет", "14–22 йәшлек йәштәр өсөн"],
  accessWheelchair: ["Доступно на коляске", "Коляскала барып була"],
  accessHearing: ["Для слабослышащих", "Насар ишетеүселәр өсөн"],
  accessVision: ["Для слабовидящих", "Насар күреүселәр өсөн"],
  ageUnknown: ["возраст не указан", "йәш күрһәтелмәгән"],
  mapApproxCity: ["адрес площадок уточняется", "майҙансыҡтар адресы аныҡлана"],
  mapMore: ["и ещё {n}", "тағы {n}"],
  placeApprox: ["Точный адрес площадки не указан — уточните у организатора", "Майҙансыҡтың теүәл адресы күрһәтелмәгән — ойоштороусынан белешегеҙ"],
  ageUnknownHint: ["Возрастное ограничение не указано — уточните у организатора", "Йәш сикләүе күрһәтелмәгән — ойоштороусынан белешегеҙ"],
} as const satisfies Record<string, readonly [string, string]>;

export type DictKey = keyof typeof D;

// ───────── Башкирский перевод из админки ─────────
// «Сайт» → «Башкирская локализация»: CSV «русский;башкирский». Загруженные переводы хранятся в настройках по русскому
// тексту и подменяют встроенные везде: интерфейс, жанры, быстрые ответы, примеры, фразы помощника. На сервере их
// подгружает getLang() (lib/server/lang.ts), в клиентский чат они передаются пропсом.

let BA_OVERRIDES: Record<string, string> = {};
export function setBaOverrides(map: Record<string, string>) {
  BA_OVERRIDES = map;
}
/** Башкирский текст для русского: перевод из админки или встроенный. */
export function baText(ru: string, builtin: string) {
  return BA_OVERRIDES[ru] || builtin;
}

/** Перевод с подстановкой {переменных}. */
export function tr(lang: Lang, key: DictKey, vars?: Record<string, string | number>) {
  let s: string = lang === "ba" ? baText(D[key][0], D[key][1]) : D[key][0];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Словарь целиком для клиентского компонента (передаётся пропсом). */
export function dict(lang: Lang) {
  return Object.fromEntries(Object.keys(D).map((k) => [k, tr(lang, k as DictKey)])) as Record<DictKey, string>;
}

/** Названия жанров на русском — как в справочнике категорий. */
const CATEGORY_RU: Record<string, string> = {
  theatre: "Театр",
  concert: "Концерты",
  exhibition: "Выставки",
  museum: "Музеи",
  kids: "Детям",
  cinema: "Кино",
  festival: "Фестивали",
  lecture: "Лекции",
  excursion: "Экскурсии",
};
const CATEGORY_BA: Record<string, string> = {
  theatre: "Театр",
  concert: "Концерттар",
  exhibition: "Күргәҙмәләр",
  museum: "Музейҙар",
  kids: "Балаларға",
  cinema: "Кино",
  festival: "Фестивалдәр",
  lecture: "Лекциялар",
  excursion: "Экскурсиялар",
};
export function categoryName(slug: string, ruName: string, lang: Lang) {
  return lang === "ba" ? baText(ruName, CATEGORY_BA[slug] ?? ruName) : ruName;
}

export function statusLabel(status: string, lang: Lang) {
  const key = ({ RESCHEDULED: "statusRescheduled", CANCELLED: "statusCancelled", SOLD_OUT: "statusSoldOut", PAST: "statusPast" } as const)[status as "PAST"];
  return key ? tr(lang, key) : null;
}

export function accessLabel(code: string, lang: Lang) {
  const key = ({ wheelchair: "accessWheelchair", hearing: "accessHearing", vision: "accessVision" } as const)[code as "vision"];
  return key ? tr(lang, key) : code;
}

/** Быстрые ответы помощника: показываем по-башкирски, отправляем по-русски (их понимают правила агента). */
const QUICK_BA: Record<string, string> = {
  Сегодня: "Бөгөн",
  "На выходных": "Ял көндәрендә",
  "С ребёнком": "Бала менән",
  Бесплатно: "Түләүһеҙ",
  Театр: "Театр",
  Концерт: "Концерт",
  Выставка: "Күргәҙмә",
  "Новый поиск": "Яңы эҙләү",
  "По Пушкинской карте": "Пушкин картаһы буйынса",
};
export function quickLabel(text: string, lang: Lang) {
  return lang === "ba" ? baText(text, QUICK_BA[text] ?? text) : text;
}

/** Примеры запросов на главной: русские по умолчанию и их башкирский перевод (по порядку). */
export const EXAMPLES_RU = ["Куда пойти в субботу с ребёнком до 1000 ₽", "Бесплатные выставки в Уфе на неделе", "Концерт классической музыки вечером"];
const EXAMPLES_BA = ["Шәмбе көнө бала менән 1000 һумға тиклем ҡайҙа барырға", "Аҙна буйына Өфөлә түләүһеҙ күргәҙмәләр", "Кискә классик музыка концерты"];
export function examplesBa() {
  return EXAMPLES_RU.map((ru, i) => baText(ru, EXAMPLES_BA[i]));
}

/** Все пары «русский — встроенный башкирский» интерфейса: для выгрузки и проверки загрузки локализации. */
export function i18nPairs(): { ru: string; ba: string }[] {
  return [
    ...Object.values(D).map(([ru, ba]) => ({ ru, ba })),
    ...Object.entries(CATEGORY_RU).map(([slug, ru]) => ({ ru, ba: CATEGORY_BA[slug] ?? ru })),
    ...Object.entries(QUICK_BA).map(([ru, ba]) => ({ ru, ba })),
    ...EXAMPLES_RU.map((ru, i) => ({ ru, ba: EXAMPLES_BA[i] })),
  ];
}

// ───────── Даты (Intl не знает башкирский — свои названия) ─────────

const TZ = "Asia/Yekaterinburg";
const MONTHS_BA = ["ғинуар", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_BA_SHORT = ["ғин", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WEEKDAYS_BA = ["йәкшәмбе", "дүшәмбе", "шишәмбе", "шаршамбы", "кесаҙна", "йома", "шәмбе"];
const WEEKDAYS_BA_SHORT = ["йш", "дш", "шш", "шр", "кс", "йм", "шб"];

/** Части даты в местном времени: число, месяц, день недели (0 — вс), время. */
function local(iso: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { day: Number(parts.day), month: Number(parts.month) - 1, wd, time: `${parts.hour}:${parts.minute}` };
}

export function dayPartsL(iso: string, lang: Lang) {
  const d = new Date(iso);
  if (lang !== "ba") {
    return {
      day: d.toLocaleDateString("ru-RU", { timeZone: TZ, day: "numeric" }),
      month: d.toLocaleDateString("ru-RU", { timeZone: TZ, month: "short" }).replace(".", ""),
      weekday: d.toLocaleDateString("ru-RU", { timeZone: TZ, weekday: "short" }),
      time: d.toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }),
    };
  }
  const l = local(iso);
  return { day: String(l.day), month: MONTHS_BA_SHORT[l.month], weekday: WEEKDAYS_BA_SHORT[l.wd], time: l.time };
}

export function formatDateLongL(iso: string, lang: Lang) {
  if (lang !== "ba") {
    return new Date(iso).toLocaleString("ru-RU", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  }
  const l = local(iso);
  return `${l.day} ${MONTHS_BA[l.month]}, ${WEEKDAYS_BA[l.wd]}, ${l.time}`;
}

export function formatPriceL(e: { priceMin: number | null; priceMax: number | null }, lang: Lang) {
  if (e.priceMin === 0 && !e.priceMax) return tr(lang, "free");
  if (e.priceMin == null) return tr(lang, "priceUnknown");
  const n = (v: number) => v.toLocaleString("ru-RU");
  return e.priceMax && e.priceMax !== e.priceMin ? `${n(e.priceMin)}–${n(e.priceMax)} ₽` : tr(lang, "priceFrom", { price: n(e.priceMin) });
}
