import { json, preflight } from "@/lib/server/cors";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await db.event.findUnique({ where: { id }, include: { venue: true, category: true, sources: true } });
  return event ? json(event) : json({ error: "not_found" }, { status: 404 });
}
