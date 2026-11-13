import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";

// Журнал изменений (ТЗ 6.1): кто, когда и что изменил. Пишут server actions админки и импорт.

export type AuditEntry = {
  userLogin: string | null;
  action: string;
  entity: "event" | "import" | "user" | "settings" | "feedback" | "source";
  entityId?: string | null;
  summary: string;
  diff?: Record<string, [unknown, unknown]> | null;
};

export async function audit(e: AuditEntry, tx: Prisma.TransactionClient = db) {
  await tx.auditLog.create({
    data: { userLogin: e.userLogin, action: e.action, entity: e.entity, entityId: e.entityId ?? null, summary: e.summary.slice(0, 500), diff: (e.diff ?? undefined) as Prisma.InputJsonValue | undefined },
  });
}

const comparable = (v: unknown) => (v instanceof Date ? v.toISOString() : Array.isArray(v) ? JSON.stringify(v) : v ?? null);

/** Что изменилось: { поле: [было, стало] } только по перечисленным полям. Пусто — null. */
export function diffFields<T extends Record<string, unknown>>(before: Partial<T> | null, after: Partial<T>, fields: (keyof T)[]) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const f of fields) {
    if (!(f in after)) continue;
    const a = comparable(before?.[f]);
    const b = comparable(after[f]);
    if (a !== b) out[f as string] = [a, b];
  }
  return Object.keys(out).length ? out : null;
}

/** Подписи полей события для журнала и интерфейса. */
export const EVENT_FIELD_LABELS: Record<string, string> = {
  title: "Название",
  description: "Описание",
  startsAt: "Начало",
  endsAt: "Окончание",
  durationMin: "Длительность, мин",
  status: "Статус",
  publication: "Публикация",
  priceMin: "Цена от",
  priceMax: "Цена до",
  ageLimit: "Возраст",
  categoryId: "Категория",
  venueId: "Площадка",
  tags: "Метки",
  language: "Язык",
  orgUrl: "Организатор",
  ticketUrl: "Билеты",
  imageUrl: "Изображение",
  pushkinCard: "Пушкинская карта",
  needsReview: "Спорная",
  reviewNote: "Причина",
  originalStartsAt: "Прежняя дата",
};
