"use server";

import { headers } from "next/headers";
import { feedbackSchema, saveFeedback, spamCheck } from "@/lib/server/feedback";

export type FeedbackState = { ok: boolean; message: string } | null;

/** Отправка формы обратной связи с сайта (без входа: защищена ловушкой, временем заполнения и лимитом с адреса). */
export async function sendFeedback(_: FeedbackState, f: FormData): Promise<FeedbackState> {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const get = (k: string) => String(f.get(k) ?? "").trim() || undefined;
  const parsed = feedbackSchema.safeParse({ kind: get("kind"), eventId: get("eventId"), name: get("name"), contact: get("contact"), message: get("message") ?? "" });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Проверьте поля формы." };
  const started = Number(f.get("started") ?? 0);
  const spam = spamCheck(ip, { honeypot: get("website"), elapsedMs: started ? Date.now() - started : undefined, message: parsed.data.message });
  if (spam === "spam") return { ok: true, message: "Спасибо! Обращение отправлено." }; // боту не подсказываем, что его поймали
  if (spam) return { ok: false, message: spam };
  await saveFeedback(parsed.data, "site");
  return { ok: true, message: "Спасибо! Обращение передано модератору афиши." + (parsed.data.contact ? " Ответим по указанному контакту." : "") };
}
