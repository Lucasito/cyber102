import "server-only";

// События из разметки schema.org (JSON-LD) на странице: <script type="application/ld+json"> с @type Event
// (и подтипами: TheaterEvent, MusicEvent, ExhibitionEvent…). Разметку ставят «Афиша Уфы», многие билетные
// сервисы и CMS учреждений. Результат — строки импорта (поля как в универсальном формате).

type Obj = Record<string, unknown>;

const isEvent = (o: Obj) => {
  const t = o["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === "string" && /Event$/.test(x));
};

/** Все объекты JSON-LD страницы, включая вложенные в @graph и массивы. */
function objects(html: string): Obj[] {
  const out: Obj[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      // Обходим разметку целиком: события бывают в @graph, в ItemList → itemListElement → item и глубже
      const walk = (v: unknown, depth = 0) => {
        if (depth > 8) return;
        if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
        else if (v && typeof v === "object") {
          out.push(v as Obj);
          for (const [k, x] of Object.entries(v as Obj)) if (k !== "location" && k !== "offers" && x && typeof x === "object") walk(x, depth + 1);
        }
      };
      walk(data);
    } catch {
      // битая разметка на странице — пропускаем блок
    }
  }
  return out;
}

/** В том числе карточки репертуара без дат: подходят для дополнения уже известных событий. */
export function jsonLdDetails(html: string): Obj[] {
  return objects(html).filter(isEvent);
}

/** Тип события schema.org → код жанра (у общего «Event» жанра нет). */
const TYPE_CATEGORY: Record<string, string> = {
  TheaterEvent: "theatre",
  MusicEvent: "concert",
  ExhibitionEvent: "exhibition",
  ChildrensEvent: "kids",
  ScreeningEvent: "cinema",
  Festival: "festival",
  EducationEvent: "lecture",
  DanceEvent: "theatre",
  VisualArtsEvent: "exhibition",
  LiteraryEvent: "lecture",
};
const categoryOf = (t: unknown) => (Array.isArray(t) ? t : [t]).map((x) => (typeof x === "string" ? TYPE_CATEGORY[x] : undefined)).find(Boolean);

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : undefined);
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/** Ограничение 6+/6-; закрытый рекомендуемый диапазон «6–12» не считаем ограничением 6+. */
export function jsonLdAge(value: unknown): number | undefined {
  const m = str(value)?.match(/^(0|6|12|16|18)\s*(?:\+|-)?$/);
  return m ? +m[1] : undefined;
}

export function jsonLdPrice(event: Obj, strictCurrency = false): { min: number; max: number | null } | undefined {
  const offers = (Array.isArray(event.offers) ? event.offers : event.offers ? [event.offers] : []).filter((v): v is Obj => !!v && typeof v === "object");
  const number = (v: unknown) => {
    const text = str(v)?.replace(/[\s\u00a0\u202f]/g, "");
    if (!text || !/^\d+(?:[.,]\d{1,2})?$/.test(text)) return;
    const n = Math.round(Number(text.replace(",", "."))); return n <= 1_000_000 ? n : undefined;
  };
  const prices = offers.map(offer => {
    const currency = str(offer.priceCurrency)?.toUpperCase();
    if (currency ? !["RUB", "RUR", "643"].includes(currency) : strictCurrency) return;
    const min = number(offer.lowPrice ?? offer.price), max = number(offer.highPrice ?? (offer.lowPrice == null ? offer.price : undefined));
    return min != null && (max == null || max >= min) ? { min, max: max ?? null } : undefined;
  });
  if (prices.length && prices.every(p => !!p)) {
    const min = Math.min(...prices.map(p => p!.min)), max = prices.every(p => p!.max != null) ? Math.max(...prices.map(p => p!.max!)) : null;
    if (event.isAccessibleForFree === true && min !== 0) return;
    if (strictCurrency && min === 0 && max !== 0) return;
    return { min, max };
  }
  if (!offers.length && event.isAccessibleForFree === true) return { min: 0, max: 0 };
}

/** Строки импорта из разметки страницы. pageUrl — ссылка на источник, если у события нет своей. */
export function jsonLdEvents(html: string, pageUrl: string): Record<string, unknown>[] {
  return objects(html)
    .filter(isEvent)
    .map((e) => {
      const loc = first(e.location) as Obj | undefined;
      const addr = (loc && typeof loc.address === "object" ? loc.address : undefined) as Obj | undefined;
      const offers = first(e.offers) as Obj | undefined;
      const status = str(e.eventStatus) ?? "";
      const age = jsonLdAge(e.contentRating ?? e.typicalAgeRange);
      const price = jsonLdPrice(e);
      return {
        title: str(e.name),
        description: str(e.description),
        category: categoryOf(e["@type"]),
        dateStart: str(e.startDate),
        dateEnd: str(e.endDate),
        venue: str(loc?.name),
        address: str(addr?.streetAddress) ?? (typeof loc?.address === "string" ? loc.address : undefined),
        city: str(addr?.addressLocality),
        lat: str((loc?.geo as Obj | undefined)?.latitude),
        lon: str((loc?.geo as Obj | undefined)?.longitude),
        priceMin: price?.min,
        priceMax: price?.max ?? undefined,
        isFree: price?.min === 0 && price.max === 0 ? true : undefined,
        ageLimit: age,
        imageUrl: str(first(e.image)) ?? str((first(e.image) as Obj | undefined)?.url),
        ticketUrl: str(offers?.url),
        sourceUrl: str(e.url) ?? pageUrl,
        externalId: str(e["@id"]),
        status: /Cancelled/i.test(status) ? "отменено" : /Rescheduled|Postponed/i.test(status) ? "перенесено" : undefined,
      };
    })
    .filter((r) => r.title && r.dateStart);
}
