import type { Metadata } from "next";
import { db } from "@/lib/server/db";
import { FeedbackForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Обратная связь и заявки организаторов" };

/** Обратная связь: заявка организатора, уточнение по событию, вопрос (ТЗ 6.3). */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ event?: string; kind?: string }> }) {
  const sp = await searchParams;
  const event = sp.event ? await db.event.findFirst({ where: { id: sp.event.slice(0, 40), publication: "PUBLISHED" }, select: { id: true, title: true } }) : null;
  return (
    <main className="mx-auto max-w-2xl px-4 pt-10 pb-16">
      <h1 className="text-3xl font-semibold tracking-tight">Обратная связь</h1>
      <p className="mt-3 text-stone-600">
        Организаторам — предложить событие в афишу. Всем — сообщить об ошибке, переносе или отмене. Модератор проверит информацию по источнику: в афишу
        попадают только события с подтверждённым источником.
      </p>
      <div className="mt-8">
        <FeedbackForm eventId={event?.id} eventTitle={event?.title} kind={sp.kind} />
      </div>
    </main>
  );
}
