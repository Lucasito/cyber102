import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, type Lang } from "@/lib/i18n";

/** Язык интерфейса из cookie (переключатель в шапке). По умолчанию — русский. */
export async function getLang(): Promise<Lang> {
  return (await cookies()).get(LANG_COOKIE)?.value === "ba" ? "ba" : "ru";
}
