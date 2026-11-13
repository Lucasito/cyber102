import "server-only";
import { getSettings } from "./settings";

// Ограничение частоты запросов к умному поиску: защищает токены ИИ и очередь от скриптов.
// Лимиты — в админке (раздел ИИ → «Лимиты»), 0 — без ограничения. С одного IP могут ходить многие
// (NAT площадки, офис), поэтому лимит на адрес щедрый; на пользователя бота — строже.
// Счётчики в памяти процесса (один контейнер); при нескольких экземплярах нужен общий Redis.

type Window = { limit: number; ms: number; label: string };

const hits = new Map<string, number[]>();
let lastCleanup = Date.now();
const DAY = 24 * 3_600_000;

/** Лимиты из настроек: kind ip — сайт и API, user — пользователь бота. */
async function windowsFor(kind: "ip" | "user"): Promise<Window[]> {
  const s = await getSettings("ai");
  const [minute, day] = kind === "ip" ? [s.rateIpMinute, s.rateIpDay] : [s.rateUserMinute, s.rateUserDay];
  return [
    ...(minute > 0 ? [{ limit: minute, ms: 60_000, label: "минуту" }] : []),
    ...(day > 0 ? [{ limit: day, ms: DAY, label: "сутки" }] : []),
  ];
}

/** Зафиксировать запрос; вернуть null или текст отказа с временем ожидания. */
export async function rateLimit(key: string, kind: "ip" | "user"): Promise<{ retryAfterSec: number; message: string } | null> {
  const windows = await windowsFor(kind);
  if (!windows.length) return null;
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < DAY);
  for (const w of windows) {
    const inWindow = list.filter((t) => now - t < w.ms);
    if (inWindow.length >= w.limit) {
      const retryAfterSec = Math.ceil((w.ms - (now - inWindow[0])) / 1000);
      hits.set(key, list);
      return {
        retryAfterSec,
        message:
          w.ms <= 60_000
            ? `Слишком много запросов подряд — подождите ${retryAfterSec} с.`
            : `Лимит запросов к помощнику на ${w.label} исчерпан. Пока можно пользоваться фильтрами афиши.`,
      };
    }
  }
  list.push(now);
  hits.set(key, list);
  // Раз в 10 минут чистим устаревшие ключи, чтобы карта не росла бесконечно
  if (now - lastCleanup > 600_000) {
    lastCleanup = now;
    for (const [k, v] of hits) if (!v.some((t) => now - t < DAY)) hits.delete(k);
  }
  return null;
}

/** IP клиента: Caddy передаёт X-Real-IP; запасной — первый адрес X-Forwarded-For. */
export function clientIp(request: Request) {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
