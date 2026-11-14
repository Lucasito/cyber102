import "server-only";
import type { Source } from "@/generated/prisma/client";
import { db } from "./db";
import { log } from "./log";
import { sendMailQuietly } from "./mail";

// Здоровье источников: после каждого сбора — сколько записей дал источник и какой у него обычный уровень.
// Проблема — источник перестал отдавать события, их число резко упало или сбор падает несколько раз подряд.
// Администраторы получают письмо один раз при появлении проблемы и один раз при восстановлении;
// текущая проблема видна в «Источниках» и на главной админки.

/** Обычный уровень не ниже — нули считаем проблемой (у маленьких лент 0–2 записи бывают и честно). */
const MIN_AVG_FOR_ZERO = 3;
/** Резкое падение: меньше этой доли обычного, если обычно записей не меньше MIN_AVG_FOR_DROP. */
const DROP_SHARE = 0.3;
const MIN_AVG_FOR_DROP = 10;
/** Ошибок сбора подряд до оповещения: одиночный сбой сети — не повод писать людям. */
const FAILS_TO_ALERT = 2;
/** Вес нового сбора в среднем; во время проблемы среднее подстраивается медленнее. */
const EMA = 0.3;
const EMA_DURING_ISSUE = 0.1;

export type HealthState = Pick<Source, "lastCount" | "avgCount" | "failStreak" | "healthIssue">;
export type Outcome = { ok: true; count: number } | { ok: false; error: string };
export type Assessment = { lastCount: number | null; avgCount: number | null; failStreak: number; healthIssue: string | null; notify: "problem" | "recovered" | null };

const round = (n: number) => Math.round(n);

/** Решение без побочных эффектов: новое состояние и нужно ли писать администраторам. */
export function assessHealth(prev: HealthState, outcome: Outcome): Assessment {
  let next: Omit<Assessment, "notify">;
  if (!outcome.ok) {
    const failStreak = prev.failStreak + 1;
    next = {
      lastCount: prev.lastCount,
      avgCount: prev.avgCount,
      failStreak,
      healthIssue: failStreak >= FAILS_TO_ALERT ? `сбор не удаётся ${failStreak} раза подряд: ${outcome.error.slice(0, 200)}` : prev.healthIssue,
    };
  } else {
    const avg = prev.avgCount;
    const { count } = outcome;
    let issue: string | null = null;
    if (avg != null && avg >= MIN_AVG_FOR_ZERO && count === 0) issue = `перестал отдавать события: 0 записей, обычно ~${round(avg)}`;
    else if (avg != null && avg >= MIN_AVG_FOR_DROP && count < avg * DROP_SHARE) issue = `резкое падение: ${count} записей вместо обычных ~${round(avg)}`;
    const w = issue ? EMA_DURING_ISSUE : EMA;
    next = { lastCount: count, avgCount: avg == null ? count : avg * (1 - w) + count * w, failStreak: 0, healthIssue: issue };
  }
  // Пишем при смене «здоров ↔ проблема»; уточнение текста той же проблемы (число ошибок растёт) — без письма
  const kind = (s: string | null) => s?.split(":")[0].replace(/\d+/g, "N") ?? null;
  const notify = next.healthIssue && kind(next.healthIssue) !== kind(prev.healthIssue) ? "problem" : !next.healthIssue && prev.healthIssue ? "recovered" : null;
  return { ...next, notify };
}

/** Записать итог сбора и при необходимости оповестить администраторов. Ошибки здесь не роняют сбор. */
export async function recordSourceHealth(source: Source, outcome: Outcome) {
  try {
    const a = assessHealth(source, outcome);
    await db.source.update({
      where: { id: source.id },
      data: { lastCount: a.lastCount, avgCount: a.avgCount, failStreak: a.failStreak, healthIssue: a.healthIssue, healthSince: a.healthIssue ? (source.healthIssue ? source.healthSince ?? new Date() : new Date()) : null },
    });
    if (!a.notify) return a;
    log(a.notify === "problem" ? "warn" : "info", a.notify === "problem" ? "source_health_problem" : "source_health_recovered", { source: source.code, issue: a.healthIssue ?? source.healthIssue });
    await notifyAdmins(source, a);
    return a;
  } catch (e) {
    log("warn", "source_health_failed", { source: source.code, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

async function notifyAdmins(source: Source, a: Assessment) {
  const admins = await db.adminUser.findMany({ where: { role: "ADMIN", active: true, email: { not: null } }, select: { email: true } });
  const link = `${(process.env.PUBLIC_URL ?? "").replace(/\/$/, "")}/admin/sources/${source.id}`;
  const mail = a.notify === "problem"
    ? {
        subject: `Источник «${source.name}»: ${a.healthIssue?.split(":")[0]}`,
        text: `Источник «${source.name}» (${source.code}) ${a.healthIssue}.\n\nАдрес источника: ${source.url}\nОткрыть в управлении: ${link}\n\nВозможные причины: сайт изменил вёрстку или адрес, закрыл страницу для роботов, временно недоступен. Нажмите «Проверить», чтобы увидеть, что сборщик видит сейчас.\n\nПовторное письмо придёт, когда источник снова заработает.\n\n—\nАфиша культуры Башкортостана, управление.`,
      }
    : {
        subject: `Источник «${source.name}» снова работает`,
        text: `Источник «${source.name}» (${source.code}) снова отдаёт события: ${a.lastCount ?? 0} записей.\n\nОткрыть в управлении: ${link}\n\n—\nАфиша культуры Башкортостана, управление.`,
      };
  for (const admin of admins) await sendMailQuietly(admin.email, mail);
}
