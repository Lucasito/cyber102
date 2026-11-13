import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/server/admin";
import { mailReady } from "@/lib/server/mail";
import { AuthCard } from "./card";
import { LoginForm } from "./login-form";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  if (await currentAdmin()) redirect("/admin");
  const [{ done }, mail] = await Promise.all([searchParams, mailReady()]);
  return (
    <AuthCard title="Вход в управление афишей" desc="Для администраторов и модераторов.">
      {done && (
        <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
          Пароль сохранён — войдите с новым паролем.
        </p>
      )}
      <LoginForm />
      {mail && (
        <Link href="/admin/forgot" className="mt-4 block text-center text-sm text-stone-500 hover:text-stone-900">
          Забыли пароль?
        </Link>
      )}
    </AuthCard>
  );
}
