import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Управление", robots: { index: false, follow: false } };

// Доступ проверяет вложенный layout (panel); страница входа /admin/login открыта всем.
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
