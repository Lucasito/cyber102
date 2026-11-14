import { createHash } from "node:crypto";

export const RECHECK_MS = 24 * 60 * 60 * 1000;
export const contentHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function shouldRecheck(known: { feedHash: string | null; checkedAt: Date | null } | undefined, feedHash: string, upcoming: boolean, now = new Date()) {
  return !known || known.feedHash !== feedHash || (upcoming && (!known.checkedAt || now.getTime() - known.checkedAt.getTime() >= RECHECK_MS));
}
