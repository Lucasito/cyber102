import "server-only";
import { maxGetMe } from "./max";
import { getSettings, maxToken, telegramConfig } from "./settings";
import { telegramGetMe } from "./telegram";

// Ссылки на ботов для сайта: только включённые в админке. Имена ботов — из API мессенджеров (кэш 10 минут).

export type BotLink = { platform: "max" | "telegram"; label: string; url: string };

let cache: { at: number; key: string; links: BotLink[] } | null = null;
const TTL_MS = 10 * 60_000;
const MAX_FALLBACK = "id026806717830_bot";

export async function botLinks(): Promise<BotLink[]> {
  const [maxSettings, tg] = await Promise.all([getSettings("max"), telegramConfig()]);
  const mToken = await maxToken();
  // Ключ кэша — что включено и какие токены: поменяли в админке — пересчитываем
  const key = `${maxSettings.enabled}:${mToken.slice(-6)}:${tg.enabled}:${tg.token.slice(-6)}:${tg.apiUrl}`;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.links;

  const links: BotLink[] = [];
  if (mToken) {
    const me = await maxGetMe(mToken).catch(() => null);
    links.push({ platform: "max", label: "MAX", url: `https://max.ru/${me?.username ?? MAX_FALLBACK}` });
  }
  if (tg.enabled) {
    const me = await telegramGetMe(tg.token, tg.apiUrl).catch(() => null);
    if (me?.username) links.push({ platform: "telegram", label: "Telegram", url: `https://t.me/${me.username}` });
  }
  cache = { at: Date.now(), key, links };
  return links;
}
