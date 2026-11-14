"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/server/admin";
import { ACCURACY_KEY, measureAfishaAccuracy } from "@/lib/server/afisha-accuracy";
import { db } from "@/lib/server/db";
import type { ActionState } from "./actions";

/** Сверить 50 опубликованных карточек с их источниками (около минуты) и сохранить отчёт. */
export async function runAccuracyCheck(): Promise<ActionState> {
  await requireAdmin("MODERATOR");
  try {
    const r = await measureAfishaAccuracy({ sample: 50 });
    await db.setting.upsert({ where: { key: ACCURACY_KEY }, create: { key: ACCURACY_KEY, value: r as unknown as Prisma.InputJsonValue }, update: { value: r as unknown as Prisma.InputJsonValue } });
    revalidatePath("/admin/quality");
    return { ok: true, message: `Точность ${r.checked ? Math.round((r.accurate / r.checked) * 100) : 0} % (${r.accurate}/${r.checked}), дублей ${r.duplicates.extra}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
