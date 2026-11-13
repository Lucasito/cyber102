import "server-only";
import { z } from "zod";
import { db } from "./db";
import { log } from "./log";
import { sendMailQuietly } from "./mail";

// Обращения (ТЗ 6.3): заявка организатора, уточнение по событию, вопрос. Сайт и API — один путь.
// Защита от спама: скрытое поле-ловушка, минимальное время заполнения формы, лимит с адреса, ссылки в тексте.

export const FEEDBACK_KINDS = { organizer: "Заявка организатора", correction: "Уточнение по событию", question: "Вопрос" } as const;

export const feedbackSchema = z.object({
  kind: z.enum(["organizer", "correction", "question"]),
  eventId: z.string().trim().max(40).optional(),
  name: z.string().trim().max(100).optional(),
  contact: z.string().trim().max(150).optional(),
  message: z.string().trim().min(10, "Опишите подробнее — не меньше 10 символов").max(3000, "Слишком длинно — не больше 3000 символов"),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;

const hits = new Map<string, number[]>();
const HOUR = 3_600_000;

/** Проверка на спам; null — можно сохранять, иначе текст отказа. */
export function spamCheck(ip: string, opts: { honeypot?: string; elapsedMs?: number; message: string }) {
  if (opts.honeypot) return "spam"; // поле скрыто от людей — заполняют только боты
  if (opts.elapsedMs != null && opts.elapsedMs < 3000) return "Форма отправлена слишком быстро — проверьте текст и отправьте ещё раз.";
  if ((opts.message.match(/https?:\/\//g) ?? []).length > 3) return "Слишком много ссылок в сообщении.";
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some((t) => now - t < HOUR)) hits.delete(k);
  const list = (hits.get(ip) ?? []).filter((t) => now - t < HOUR);
  if (list.length >= 5) return "Слишком много обращений с вашего адреса — попробуйте через час.";
  hits.set(ip, [...list, now]);
  return null;
}

export async function saveFeedback(input: FeedbackInput, source: "site" | "api" | "bot") {
  const event = input.eventId ? await db.event.findUnique({ where: { id: input.eventId }, select: { id: true, title: true } }) : null;
  const fb = await db.feedback.create({
    data: { kind: input.kind, eventId: event?.id ?? null, name: input.name || null, contact: input.contact || null, message: input.message, source },
  });
  log("info", "feedback_created", { id: fb.id, kind: fb.kind, source });
  // Письмо модераторам и администраторам с почтой — без контакта автора (он виден в админке)
  const staff = await db.adminUser.findMany({ where: { active: true, email: { not: null } }, select: { email: true } });
  const base = process.env.PUBLIC_URL ?? "";
  for (const s of staff)
    void sendMailQuietly(s.email, {
      subject: `Новое обращение: ${FEEDBACK_KINDS[input.kind]}`,
      text: `${FEEDBACK_KINDS[input.kind]}${event ? ` по событию «${event.title}»` : ""}.\n\n${input.message.slice(0, 500)}${input.message.length > 500 ? "…" : ""}\n\nОткрыть: ${base}/admin/feedback`,
    });
  return fb;
}
