import { requireAdmin } from "@/lib/server/admin";
import { localizationEntries, toCsv } from "@/lib/server/localization";

export const dynamic = "force-dynamic";

/** Выгрузка башкирской локализации: CSV «Русский;Башкирский» (UTF-8 с BOM — открывается в Excel). */
export async function GET() {
  await requireAdmin();
  const csv = toCsv(await localizationEntries());
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="afisha-ba-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
