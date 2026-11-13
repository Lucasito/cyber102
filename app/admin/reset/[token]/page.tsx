import Link from "next/link";
import { readAdminToken } from "@/lib/server/admin";
import { MIN_PASSWORD_LENGTH } from "@/lib/server/password";
import { AuthCard } from "../../login/card";
import { ResetForm } from "../../login/forms";

export const metadata = { referrer: "no-referrer" as const };

/** Ссылка из письма: новый пароль (восстановление) или первый пароль (приглашение). */
export default async function AdminResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await readAdminToken(token);
  if (!found)
    return (
      <AuthCard title="Ссылка не действует" desc="Она устарела или уже использована.">
        <Link href="/admin/login" className="text-sm text-stone-600 underline-offset-2 hover:underline">
          Ко входу — там можно запросить новую
        </Link>
      </AuthCard>
    );
  return (
    <AuthCard title={found.kind === "invite" ? "Добро пожаловать" : "Новый пароль"} desc={`Логин: ${found.user.login}. Задайте пароль для входа.`}>
      <ResetForm token={token} minLength={MIN_PASSWORD_LENGTH} />
    </AuthCard>
  );
}
