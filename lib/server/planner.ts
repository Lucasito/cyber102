import "server-only";
import { z } from "zod";
import { db } from "./db";
import { distanceKm, eventInclude, localDay, TZ, type EventItem } from "./events";

// Планировщик «Выходной день» (ТЗ, уровень 4): 2–4 события на один день, по времени, без пересечений,
// с оценкой переездов и общей стоимостью. Перебор с отсечениями — без модели: план проверяем и воспроизводим.
// Если условия несовместимы — какое ограничение нарушено и минимальная правка (поднять бюджет, расширить окно,
// разрешить переезд дольше, убрать событие).

export const planInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // день по местному времени
  city: z.string().trim().min(1).max(100).default("Уфа"),
  budget: z.coerce.number().int().min(0).max(1_000_000).optional(), // на всех, ₽; нет — без ограничения
  persons: z.coerce.number().int().min(1).max(20).default(1),
  age: z.coerce.number().int().min(0).max(18).optional(), // младший участник: события с ageLimit ≤ age
  from: z.string().regex(/^\d{1,2}:\d{2}$/).default("10:00"), // свободное окно
  to: z.string().regex(/^\d{1,2}:\d{2}$/).default("22:00"),
  maxTravelMin: z.coerce.number().int().min(0).max(240).default(40), // на один переезд
  count: z.coerce.number().int().min(2).max(4).default(3), // сколько событий хочется
});
export type PlanInput = z.infer<typeof planInputSchema>;

export type PlanItem = {
  event: EventItem;
  start: Date;
  end: Date;
  flexible: boolean; // выставка или музей: время посещения выбрано планировщиком
  travelMin: number; // переезд от предыдущего события
  cost: number | null; // на всех; null — цена не указана
};

export type PlanViolation = { constraint: "budget" | "window" | "travel" | "count" | "data"; message: string; fix: string };

export type PlanResult =
  | { ok: true; items: PlanItem[]; totalCost: number; unknownPrice: boolean; travelMin: number; input: PlanInput; note?: string }
  | { ok: false; violations: PlanViolation[]; input: PlanInput; best?: PlanItem[] };

/** Скорость по городу с остановками и пробками; плюс время на выход-вход. */
const CITY_KMH = 20;
const TRANSFER_OVERHEAD_MIN = 10;
/** Посещение выставки или музея, если длительность не указана. */
const FLEX_VISIT_MIN = 90;
/** Музеи и выставки открыты — без расписания работы в данных берём типичное. */
const OPEN = "10:00";
const CLOSE = "18:00";
const MAX_CANDIDATES = 30;

const at = (date: string, hm: string) => new Date(`${date}T${hm.padStart(5, "0")}:00+05:00`);
const hm = (d: Date) => d.toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const minutes = (ms: number) => Math.round(ms / 60_000);

type Candidate = { event: EventItem; flexible: boolean; start: Date; end: Date; durMin: number; cost: number | null };

/** Переезд между площадками, мин: по прямой со скоростью по городу; та же площадка — 0; нет координат — 20. */
function travel(a: EventItem, b: EventItem) {
  if (a.venueId && a.venueId === b.venueId) return 0;
  const va = a.venue;
  const vb = b.venue;
  if (va?.lat == null || va.lon == null || vb?.lat == null || vb.lon == null) return 20;
  return Math.round((distanceKm({ lat: va.lat, lon: va.lon }, { lat: vb.lat, lon: vb.lon }) / CITY_KMH) * 60) + TRANSFER_OVERHEAD_MIN;
}

/** События дня в городе: идущие в этот день по расписанию и открытые выставки (время подберём сами). */
async function candidates(input: PlanInput): Promise<Candidate[]> {
  const dayStart = at(input.date, "00:00");
  const dayEnd = at(input.date, "23:59");
  const rows = await db.event.findMany({
    where: {
      status: { notIn: ["PAST", "CANCELLED", "SOLD_OUT"] },
      publication: "PUBLISHED",
      venue: { city: { equals: input.city, mode: "insensitive" } },
      startsAt: { lte: dayEnd },
      OR: [{ startsAt: { gte: dayStart } }, { endsAt: { gte: dayStart } }],
      ...(input.age != null ? { AND: [{ OR: [{ ageLimit: null }, { ageLimit: { lte: input.age } }] }] } : {}),
    },
    include: eventInclude,
    orderBy: { startsAt: "asc" },
    take: 200,
  });
  const out: Candidate[] = [];
  for (const e of rows) {
    const item: EventItem = { ...e, distanceKm: null };
    const cost = e.priceMin == null ? null : e.priceMin * input.persons;
    const end = e.endsAt ?? new Date(e.startsAt.getTime() + 2 * 3_600_000);
    const multiDay = end.getTime() - e.startsAt.getTime() > 12 * 3_600_000;
    if (multiDay) {
      out.push({ event: item, flexible: true, start: at(input.date, OPEN), end: at(input.date, CLOSE), durMin: e.durationMin ?? FLEX_VISIT_MIN, cost });
    } else if (e.startsAt >= dayStart) {
      out.push({ event: item, flexible: false, start: e.startsAt, end, durMin: minutes(end.getTime() - e.startsAt.getTime()), cost });
    }
  }
  return out.slice(0, MAX_CANDIDATES);
}

type Limits = { budget: number; from: Date; to: Date; maxTravelMin: number };

/**
 * Лучшие планы перебором: больше событий (до count), затем меньше в дороге, затем дешевле.
 * Возвращает лучший план каждой длины — для объяснения несовместимости.
 */
function search(cands: Candidate[], limits: Limits, count: number) {
  type Score = { flex: number; travel: number; cost: number };
  const best = new Map<number, { items: PlanItem[] } & Score>();
  // При равном числе событий: меньше выставок «в любое время» (события по расписанию интереснее), меньше в дороге, дешевле
  const better = (a: Score, b?: Score) =>
    !b || a.flex < b.flex || (a.flex === b.flex && (a.travel < b.travel || (a.travel === b.travel && a.cost < b.cost)));
  const used = new Set<string>();
  const walk = (plan: PlanItem[], cost: number, travelSum: number) => {
    if (plan.length >= 1) {
      const cur = best.get(plan.length);
      const score = { flex: plan.filter((p) => p.flexible).length, travel: travelSum, cost };
      if (better(score, cur)) best.set(plan.length, { items: [...plan], ...score });
    }
    if (plan.length >= count) return;
    const last = plan.at(-1);
    for (const c of cands) {
      if (used.has(c.event.id)) continue;
      const tr = last ? travel(last.event, c.event) : 0;
      if (last && tr > limits.maxTravelMin) continue;
      const ready = new Date(Math.max(limits.from.getTime(), last ? last.end.getTime() + tr * 60_000 : 0));
      let start: Date;
      let end: Date;
      if (c.flexible) {
        start = new Date(Math.max(ready.getTime(), c.start.getTime()));
        end = new Date(start.getTime() + c.durMin * 60_000);
        if (end > c.end) continue;
      } else {
        if (c.start < ready) continue;
        start = c.start;
        end = c.end;
      }
      if (end > limits.to) continue;
      const add = c.cost ?? 0;
      if (cost + add > limits.budget) continue;
      // Порядок по времени: следующее событие начинается не раньше конца предыдущего (с переездом) — выполняется выше
      used.add(c.event.id);
      plan.push({ event: c.event, start, end, flexible: c.flexible, travelMin: tr, cost: c.cost });
      walk(plan, cost + add, travelSum + tr);
      plan.pop();
      used.delete(c.event.id);
    }
  };
  walk([], 0, 0);
  return best;
}

/** Составить план дня. */
export async function planDay(raw: unknown): Promise<PlanResult> {
  const input = planInputSchema.parse(raw);
  const cands = await candidates(input);
  const limits: Limits = { budget: input.budget ?? Infinity, from: at(input.date, input.from), to: at(input.date, input.to), maxTravelMin: input.maxTravelMin };
  if (limits.to <= limits.from) {
    return { ok: false, input, violations: [{ constraint: "window", message: `Окно ${input.from}–${input.to} пустое`, fix: "укажите время начала раньше времени окончания" }] };
  }
  if (cands.length < 2) {
    return {
      ok: false,
      input,
      violations: [
        {
          constraint: "data",
          message: `В афише на ${dayWords(input.date)} в городе ${input.city} ${cands.length ? "только одно подходящее событие" : "нет подходящих событий"}${input.age != null ? ` для возраста ${input.age}+` : ""}`,
          fix: "выберите другой день или город",
        },
      ],
      best: cands.length ? search(cands, limits, 1).get(1)?.items : undefined,
    };
  }

  const found = search(cands, limits, input.count);
  const sizes = [...found.keys()].filter((n) => n >= 2).sort((a, b) => b - a);
  if (sizes.length) {
    const plan = found.get(sizes[0])!;
    const note = sizes[0] < input.count ? `Уместилось ${sizes[0]} из ${input.count} событий: ${whyShort(cands, limits, input)}` : undefined;
    return { ok: true, input, items: plan.items, totalCost: plan.cost, unknownPrice: plan.items.some((i) => i.cost == null), travelMin: plan.travel, note };
  }

  // Двух событий не уложить — ищем, какое одно ограничение мешает, и минимальную правку
  const violations: PlanViolation[] = [];
  const free = { budget: Infinity, from: at(input.date, "00:00"), to: at(input.date, "23:59"), maxTravelMin: 240 };
  const need = (l: Limits) => search(cands, l, 2).get(2);
  if (input.budget != null) {
    const p = need({ ...limits, budget: Infinity });
    if (p) violations.push({ constraint: "budget", message: `Бюджета ${input.budget} ₽ не хватает даже на два события`, fix: `поднять бюджет до ${p.cost} ₽` });
  }
  const pw = need({ ...limits, from: free.from, to: free.to });
  if (pw) {
    const s = pw.items[0].start;
    const e = pw.items.at(-1)!.end;
    violations.push({ constraint: "window", message: `В окно ${input.from}–${input.to} два события не помещаются`, fix: `сдвинуть время: ${hm(s)}–${hm(e)}` });
  }
  const pt = need({ ...limits, maxTravelMin: free.maxTravelMin });
  if (pt) {
    const maxTr = Math.max(...pt.items.map((i) => i.travelMin));
    violations.push({ constraint: "travel", message: `Переезды дольше ${input.maxTravelMin} мин`, fix: `разрешить переезд до ${maxTr} мин` });
  }
  if (!violations.length) {
    // Одной правки мало — ищем пару: бюджет + время, бюджет + переезды, время + переезды
    const relax = {
      budget: (l: Limits) => ({ ...l, budget: Infinity }),
      window: (l: Limits) => ({ ...l, from: free.from, to: free.to }),
      travel: (l: Limits) => ({ ...l, maxTravelMin: free.maxTravelMin }),
    };
    const pairs: [keyof typeof relax, keyof typeof relax][] = [
      ["budget", "window"],
      ["budget", "travel"],
      ["window", "travel"],
    ];
    for (const [a, b] of pairs) {
      if ((a === "budget" || b === "budget") && input.budget == null) continue;
      const p = need(relax[b](relax[a](limits)));
      if (!p) continue;
      const fixes = [a, b].map((k) =>
        k === "budget"
          ? `поднять бюджет до ${p.cost} ₽`
          : k === "window"
            ? `сдвинуть время: ${hm(p.items[0].start)}–${hm(p.items.at(-1)!.end)}`
            : `разрешить переезд до ${Math.max(...p.items.map((i) => i.travelMin))} мин`,
      );
      const names = { budget: "бюджет", window: "время", travel: "переезды" };
      violations.push({ constraint: a, message: `Мешают сразу два условия — ${names[a]} и ${names[b]}`, fix: fixes.join(" и ") });
      break;
    }
  }
  if (!violations.length) {
    violations.push({ constraint: "count", message: "Двух подходящих событий в этот день не набирается", fix: "оставить одно событие или выбрать другой день" });
  }
  return { ok: false, input, violations, best: found.get(1)?.items };
}

/** Почему не уместилось столько, сколько хотелось — коротко, для пометки к плану. */
function whyShort(cands: Candidate[], limits: Limits, input: PlanInput) {
  const more = (l: Limits) => [...search(cands, l, input.count).keys()].some((n) => n >= input.count);
  if (input.budget != null && more({ ...limits, budget: Infinity })) return "не хватает бюджета";
  if (more({ ...limits, from: at(input.date, "00:00"), to: at(input.date, "23:59") })) return "не хватает времени в окне";
  if (more({ ...limits, maxTravelMin: 240 })) return "мешают долгие переезды";
  return "в этот день мало подходящих событий";
}

/** «субботу, 14 ноября» — для «на …» (винительный падеж дня недели). */
const ACCUSATIVE: Record<string, string> = { среда: "среду", пятница: "пятницу", суббота: "субботу" };
const dayWords = (date: string) => {
  const d = new Date(`${date}T12:00:00+05:00`);
  const wd = d.toLocaleDateString("ru-RU", { timeZone: TZ, weekday: "long" });
  return `${ACCUSATIVE[wd] ?? wd}, ${d.toLocaleDateString("ru-RU", { timeZone: TZ, day: "numeric", month: "long" })}`;
};

/** План словами — ответ агента и бота собирает код, без модели. */
export function planText(r: PlanResult): string {
  const i = r.input;
  const who = i.persons > 1 ? `на ${i.persons} чел.` : "на одного";
  const head = `План на ${dayWords(i.date)}, ${i.city} (${who}${i.budget != null ? `, бюджет ${i.budget} ₽` : ""}${i.age != null ? `, возраст ${i.age}+` : ""}):`;
  if (!r.ok) {
    return [
      `Составить план на ${dayWords(i.date)} не получилось.`,
      ...r.violations.map((v) => `• ${v.message}. Можно ${v.fix}.`),
    ].join("\n");
  }
  const lines = r.items.map((p, n) => {
    const price = p.cost == null ? "цена не указана" : p.cost === 0 ? "бесплатно" : `${p.cost} ₽${i.persons > 1 ? ` (${p.event.priceMin} ₽ × ${i.persons})` : ""}`;
    const road = n > 0 ? (p.travelMin ? `   ↳ переезд ~${p.travelMin} мин\n` : "   ↳ там же\n") : "";
    const title = p.event.title.includes("«") ? p.event.title : `«${p.event.title}»`;
    return `${road}${n + 1}. ${hm(p.start)}–${hm(p.end)} — ${title}, ${p.event.venue?.name ?? "площадка не указана"} — ${price}${p.flexible ? " (выставка, время посещения — на ваш выбор)" : ""}`;
  });
  const total = `Итого: ${r.totalCost} ₽${r.unknownPrice ? " + события без указанной цены" : ""}, в дороге ~${r.travelMin} мин.`;
  return [head, ...lines, total, ...(r.note ? [r.note + "."] : [])].join("\n");
}

/** День плана по умолчанию — ближайшая суббота (или сегодня, если сегодня выходной). */
export function defaultPlanDate(now = new Date()) {
  const dow = Number(new Date(now.toLocaleString("en-US", { timeZone: TZ })).getDay());
  return dow === 6 || dow === 0 ? localDay(0, now) : localDay(6 - dow, now);
}
