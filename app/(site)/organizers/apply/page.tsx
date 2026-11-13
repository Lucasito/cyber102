import type { Metadata } from "next";
import Link from "next/link";
import { MIN_PASSWORD_LENGTH } from "@/lib/server/password";
import { ApplyForm } from "./form";

export const metadata: Metadata = {
  title: "Регистрация организатора",
  description: "Заявка на кабинет организатора: учреждения и компании сами добавляют события в афишу культуры Башкортостана.",
};

export default function ApplyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 pt-10 pb-16">
      <h1 className="text-3xl font-semibold tracking-tight">Регистрация организатора</h1>
      <p className="mt-3 text-stone-600">
        Кабинет организатора — для театров, музеев, филармоний, домов культуры и других организаторов событий в Башкортостане. В нём можно добавлять события по одному или
        файлом; каждое событие проверяет модератор. Заявку рассматривает модератор афиши — о решении придёт письмо.
      </p>
      <p className="mt-2 text-sm text-stone-500">
        Публикуете афишу на своём сайте? Удобнее подключить ленту в{" "}
        <Link href="/docs/format" className="underline">
          универсальном формате
        </Link>{" "}
        — события будут попадать в афишу сами. Уже есть доступ —{" "}
        <Link href="/admin/login" className="underline">
          войти
        </Link>
        .
      </p>
      <div className="mt-8">
        <ApplyForm minPassword={MIN_PASSWORD_LENGTH} />
      </div>
    </main>
  );
}
