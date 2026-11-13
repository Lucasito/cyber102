import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle, Section, Stat } from "@/components/admin/blocks";
import { fmtDateTime } from "@/components/admin/event-badges";
import { ImportReportTable } from "@/components/admin/import-report";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import type { RowResult } from "@/lib/server/import";

export default async function AdminImportRun({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("MODERATOR");
  const { id } = await params;
  const run = await db.importRun.findUnique({ where: { id } });
  if (!run) notFound();
  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/admin/import">← Импорт</Link>
      </p>
      <PageTitle title={run.fileName} desc={`${fmtDateTime(run.createdAt)} · источник ${run.source} · ${run.userLogin ?? "система"}`} />
      <Section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="строк" value={run.total} />
          <Stat label="добавлено" value={run.created} />
          <Stat label="обновлено" value={run.updated} />
          <Stat label="без изменений" value={run.unchanged} />
          <Stat label="отклонено" value={run.rejected} tone={run.rejected ? "warn" : undefined} />
        </div>
      </Section>
      <Section title="По строкам">
        <ImportReportTable rows={run.report as unknown as RowResult[]} />
      </Section>
    </>
  );
}
