import { apiRoute } from "@/lib/server/api";
import { apiError, json, preflight } from "@/lib/server/cors";
import { defaultPlanDate, planDay, planInputSchema } from "@/lib/server/planner";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/**
 * GET /api/v1/plan — планировщик «Выходной день»: 2–4 события на один день по времени, без пересечений,
 * с переездами и общей стоимостью. Несовместимые условия — 200 с ok: false и списком нарушений с правками.
 * Параметры: date (YYYY-MM-DD, по умолчанию ближайшая суббота), city, budget (на всех, ₽), persons, age,
 * from, to (HH:MM — свободное окно), maxTravelMin (на один переезд), count (2–4),
 * types (слаги категорий через запятую: theatre,cinema; пусто — все типы).
 */
export const GET = apiRoute("GET /api/v1/plan", async (request) => {
  const sp = new URL(request.url).searchParams;
  const params: Record<string, string> = Object.fromEntries([...sp].filter(([, v]) => v !== ""));
  // types можно передать списком через запятую или повторами (?types=theatre&types=cinema)
  if (sp.has("types")) params.types = sp.getAll("types").join(",");
  const input = planInputSchema.safeParse({ date: defaultPlanDate(), ...params });
  if (!input.success) {
    return apiError(400, "bad_request", "Неверные параметры плана", input.error.issues.map((i) => ({ param: i.path.join("."), problem: i.message })));
  }
  const r = await planDay(input.data);
  if (!r.ok) {
    return json({
      ok: false,
      input: r.input,
      violations: r.violations,
      best: r.best?.map((p) => ({ event: p.event, start: p.start, end: p.end })) ?? [],
    });
  }
  return json({
    ok: true,
    input: r.input,
    items: r.items.map((p) => ({ event: p.event, start: p.start, end: p.end, flexible: p.flexible, travelMin: p.travelMin, cost: p.cost, travelUnknown: p.travelUnknown, durationEstimated: p.durationEstimated })),
    totalCost: r.totalCost,
    unknownPrice: r.unknownPrice,
    travelMin: r.travelMin,
    note: r.note ?? null,
  });
});
