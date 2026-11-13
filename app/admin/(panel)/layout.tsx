import { AdminSidebar } from "@/components/admin/sidebar";
import { requireAdmin } from "@/lib/server/admin";
import { ROLE_LABELS } from "@/lib/server/password";
import { logout } from "../actions";

/** Каркас админки: меню слева. Без сессии — на /admin/login. Роль проверяет каждая страница сама. */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const me = await requireAdmin("ORGANIZER");
  return (
    <div className="min-h-dvh bg-[#f7f6f3]">
      <AdminSidebar login={me.login} role={me.role} roleLabel={ROLE_LABELS[me.role]} logout={logout} />
      <div className="lg:pl-64">
        <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
