import "server-only";
import { log } from "../log";

// robots.txt сайтов-источников: сборщик не загружает то, что сайт закрыл для роботов.
// Правила — для нашего агента (AfishaRB) или, если их нет, для всех (*). Allow / Disallow, шаблоны * и $,
// побеждает самое длинное совпадение (при равенстве — Allow), как у поисковых роботов.
// robots.txt нет (4xx) — можно всё; не загрузился (сеть, 5xx) — тоже не блокируем сбор, пишем в лог.

const AGENT = "afisharb";
const TTL_MS = 6 * 3_600_000;
const cache = new Map<string, { rules: Rule[]; at: number }>();

type Rule = { allow: boolean; pattern: string };

/** Правила из текста robots.txt для нашего агента (или для «*»). */
export function parseRobots(text: string, agent = AGENT): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (key === "disallow" && !value) continue; // пустой Disallow — можно всё
      current.rules.push({ allow: key === "allow", pattern: value });
    } else lastWasAgent = false;
  }
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

/** Подходит ли путь (с запросом) под шаблон robots.txt: * — любые символы, $ — конец адреса. */
function matches(path: string, pattern: string) {
  const end = pattern.endsWith("$");
  const body = (end ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${end ? "$" : ""}`).test(path);
}

/** Разрешён ли путь правилами: самое длинное совпадение, при равенстве — Allow. */
export function isAllowed(rules: Rule[], path: string) {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!matches(path, r.pattern)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

/** Можно ли сборщику загружать этот адрес по robots.txt сайта (с кешем на 6 часов). */
export async function robotsAllow(url: URL, userAgent: string): Promise<boolean> {
  const origin = url.origin;
  let entry = cache.get(origin);
  if (!entry || Date.now() - entry.at > TTL_MS) {
    let rules: Rule[] = [];
    try {
      const res = await fetch(`${origin}/robots.txt`, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": userAgent } });
      if (res.ok) rules = parseRobots((await res.text()).slice(0, 500_000));
      else if (res.status >= 500) log("warn", "robots_unavailable", { origin, status: res.status });
    } catch (e) {
      log("warn", "robots_unavailable", { origin, error: e instanceof Error ? e.message : String(e) });
    }
    entry = { rules, at: Date.now() };
    cache.set(origin, entry);
  }
  return isAllowed(entry.rules, url.pathname + url.search);
}
