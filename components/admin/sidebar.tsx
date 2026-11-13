"use client";

import { BarChart3, Bot, Brain, CalendarDays, Database, FileUp, Globe, History, LayoutDashboard, ListTree, LogOut, Mail, Map, Menu, MessageSquare, ShieldCheck, SlidersHorizontal, UserCog, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

// Меню админки: слева на компьютере, выезжающее — на телефоне. Пункты фильтруются по роли.

type Role = "ADMIN" | "MODERATOR";
type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
};

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Работа",
    items: [
      { href: "/admin", label: "Обзор", icon: LayoutDashboard, roles: ["ADMIN", "MODERATOR"] },
      { href: "/admin/events", label: "События", icon: CalendarDays, roles: ["ADMIN", "MODERATOR"] },
      { href: "/admin/moderation", label: "Модерация", icon: ShieldCheck, roles: ["ADMIN", "MODERATOR"] },
      { href: "/admin/import", label: "Импорт", icon: FileUp, roles: ["ADMIN", "MODERATOR"] },
      { href: "/admin/feedback", label: "Обращения", icon: MessageSquare, roles: ["ADMIN", "MODERATOR"] },
      { href: "/admin/audit", label: "Журнал", icon: History, roles: ["ADMIN", "MODERATOR"] },
      {
        href: "/admin/analytics",
        label: "Аналитика",
        icon: BarChart3,
        roles: ["ADMIN"],
      },
      { href: "/admin/traces", label: "Трассы", icon: ListTree, roles: ["ADMIN"] },
      {
        href: "/admin/data",
        label: "Данные",
        icon: Database,
        roles: ["ADMIN"],
      },
    ],
  },
  {
    title: "Настройки",
    items: [
      { href: "/admin/site", label: "Сайт", icon: Globe, roles: ["ADMIN"] },
      {
        href: "/admin/ai",
        label: "ИИ-помощник",
        icon: Brain,
        roles: ["ADMIN"],
      },
      { href: "/admin/bots", label: "Боты", icon: Bot, roles: ["ADMIN"] },
      { href: "/admin/map", label: "Карта", icon: Map, roles: ["ADMIN"] },
      { href: "/admin/mail", label: "Почта", icon: Mail, roles: ["ADMIN"] },
      {
        href: "/admin/tuning",
        label: "Тонкая настройка",
        icon: SlidersHorizontal,
        roles: ["ADMIN"],
      },
    ],
  },
  {
    title: "Доступ",
    items: [
      {
        href: "/admin/users",
        label: "Пользователи",
        icon: Users,
        roles: ["ADMIN"],
      },
      {
        href: "/admin/profile",
        label: "Мой профиль",
        icon: UserCog,
        roles: ["ADMIN", "MODERATOR"],
      },
    ],
  },
];

export function AdminSidebar({ login, roleLabel, role, logout }: { login: string; roleLabel: string; role: Role; logout: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));

  const nav = (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <Link href="/admin" className="px-2 font-semibold" onClick={() => setOpen(false)}>
        Управление афишей
      </Link>
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => i.roles.includes(role));
        if (!items.length) return null;
        return (
          <div key={g.title}>
            <p className="mb-1 px-2 text-xs font-medium tracking-wide text-stone-400 uppercase">{g.title}</p>
            <ul className="space-y-0.5">
              {items.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    aria-current={active(href) ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm ${active(href) ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-black/5"}`}
                  >
                    <Icon className="size-4 shrink-0" />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <div className="mt-auto space-y-2 border-t border-black/5 pt-4 text-sm">
        <div className="px-2">
          <div className="font-medium">{login}</div>
          <div className="text-xs text-stone-500">{roleLabel}</div>
        </div>
        <Link href="/" className="block rounded-xl px-2.5 py-1.5 text-stone-600 hover:bg-black/5">
          ← На сайт
        </Link>
        <form action={logout}>
          <button className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-stone-600 hover:bg-black/5">
            <LogOut className="size-4" /> Выйти
          </button>
        </form>
      </div>
    </nav>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-black/5 bg-[#f7f6f3]/90 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Открыть меню" className="-ml-1 rounded-lg p-1.5 hover:bg-black/5">
          <Menu className="size-5" />
        </button>
        <span className="font-semibold">Управление афишей</span>
      </div>
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-black/5 bg-white lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-black/30" aria-label="Закрыть меню" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
            <button onClick={() => setOpen(false)} aria-label="Закрыть меню" className="absolute top-3 right-3 rounded-lg p-1.5 hover:bg-black/5">
              <X className="size-5" />
            </button>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
