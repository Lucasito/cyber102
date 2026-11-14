import { calendar } from "@/lib/ical";
import { defaultPlanDate, planDay, planInputSchema } from "@/lib/server/planner";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries([...url.searchParams].filter(([, v]) => v !== ""));
  const parsed = planInputSchema.safeParse({ date: defaultPlanDate(), ...params });
  if (!parsed.success) return new Response("Проверьте условия плана", { status: 400 });
  const plan = await planDay(parsed.data);
  if (!plan.ok) return new Response("План изменился или больше не соответствует условиям. Откройте план и подберите маршрут заново.", { status: 409 });
  const base = process.env.PUBLIC_URL || url.origin;
  const body = calendar(plan.items.map((p) => ({ id: `plan-${p.event.id}-${parsed.data.date}`, title: p.event.title, start: p.start, end: p.end,
    location: [p.event.venue?.name, p.event.venue?.address, p.event.venue?.city].filter(Boolean).join(", "), url: `${base}/events/${p.event.id}`,
    description: [p.flexible ? "Время посещения выбрано для плана: уточните часы работы у организатора." : "", p.durationEstimated ? "Длительность приблизительная." : "", `${base}/events/${p.event.id}`].filter(Boolean).join("\n"),
  })));
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="plan-${parsed.data.date}.ics"`, "Cache-Control": "no-store" } });
}
