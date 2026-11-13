import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** Проверка живости для Docker и мониторинга: приложение отвечает и видит БД. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
