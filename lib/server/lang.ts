import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, setBaOverrides, type Lang } from "@/lib/i18n";
import { getSettings } from "./settings";

/** Подгрузить башкирский перевод из админки (кэш настроек — несколько секунд). */
export async function loadBaOverrides() {
  const map = (await getSettings("i18n")).ba;
  setBaOverrides(map);
  return map;
}

/** Язык интерфейса из cookie (переключатель в шапке). По умолчанию — русский. Заодно — перевод из админки. */
export async function getLang(): Promise<Lang> {
  const lang = (await cookies()).get(LANG_COOKIE)?.value === "ba" ? "ba" : "ru";
  if (lang === "ba") await loadBaOverrides();
  return lang;
}
