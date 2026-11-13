import { notFound } from "next/navigation";
import { mailReady } from "@/lib/server/mail";
import { AuthCard } from "../login/card";
import { ForgotForm } from "../login/forms";

export default async function AdminForgotPage() {
  if (!(await mailReady())) notFound(); // без почты восстановление — только через администратора
  return (
    <AuthCard title="Восстановление пароля" desc="Пришлём на почту ссылку для нового пароля.">
      <ForgotForm />
    </AuthCard>
  );
}
