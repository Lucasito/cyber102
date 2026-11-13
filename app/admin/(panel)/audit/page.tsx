import Link from "next/link";
import { PageTitle, Section } from "@/components/admin/blocks";
import { AuditList } from "@/components/admin/audit-list";
import { requireAdmin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";

const PAGE = 50;

/** Журнал изменений (ТЗ 6.1): кто, когда и что изменил. */
export default async function AdminAudit({ searchParams }: { searchParams: Promise<{ page?: string; user?: string }> }) {
  await requireAdmin("MODERATOR");
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where = sp.user ? { userLogin: sp.user } : {};
  const [items, total, users] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: PAGE, skip: (page - 1) * PAGE }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({ distinct: ["userLogin"], select: { userLogin: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (p: number, user = sp.user) => `/admin/audit?${new URLSearchParams({ ...(p > 1 ? { page: String(p) } : {}), ...(user ? { user } : {}) })}`;
  return (
    <>
      <PageTitle title="Журнал изменений" desc="Кто, когда и что изменил: события, импорт, модерация. Поля показаны как «было → стало»." />
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/admin/audit" className={`rounded-full px-3 py-1.5 ${!sp.user ? "bg-stone-900 text-white" : "bg-white ring-1 ring-black/10"}`}>
          Все
        </Link>
        {users.map((u) => (
          <Link key={u.userLogin ?? "-"} href={href(1, u.userLogin ?? undefined)} className={`rounded-full px-3 py-1.5 ${sp.user === u.userLogin ? "bg-stone-900 text-white" : "bg-white ring-1 ring-black/10"}`}>
            {u.userLogin ?? "система"}
          </Link>
        ))}
      </div>
      <Section>
        <AuditList items={items} links />
        {pages > 1 && (
          <nav className="mt-4 flex justify-between text-sm" aria-label="Страницы">
            {page > 1 ? <Link href={href(page - 1)}>← Новее</Link> : <span />}
            <span className="text-stone-500">
              {page} из {pages}
            </span>
            {page < pages ? <Link href={href(page + 1)}>Старше →</Link> : <span />}
          </nav>
        )}
      </Section>
    </>
  );
}
