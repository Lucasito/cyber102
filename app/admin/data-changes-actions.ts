"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/server/admin";
import { reviewDataChange } from "@/lib/server/data-changes";
import type { ActionState } from "./actions";

export async function decideDataChange(id: string, accept: boolean): Promise<ActionState> {
  const me = await requireAdmin("MODERATOR");
  try {
    const message = await reviewDataChange(id, accept, me.login);
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}
