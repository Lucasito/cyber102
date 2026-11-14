// Правила оповещения о сбоях источников (lib/server/source-health.ts): npm run test:source-health
import "dotenv/config";
import assert from "node:assert/strict";
import { assessHealth, type HealthState } from "../lib/server/source-health.ts";

let failed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : e}`);
  }
};
const healthy: HealthState = { lastCount: 40, avgCount: 40, failStreak: 0, healthIssue: null };
/** Прогнать несколько сборов подряд. */
const run = (start: HealthState, outcomes: Parameters<typeof assessHealth>[1][]) => {
  let s = start;
  return outcomes.map((o) => { const a = assessHealth(s, o); s = a; return a; });
};

check("первый сбор задаёт обычный уровень без оповещения", () => {
  const a = assessHealth({ lastCount: null, avgCount: null, failStreak: 0, healthIssue: null }, { ok: true, count: 0 });
  assert.deepEqual([a.healthIssue, a.notify, a.avgCount], [null, null, 0]);
});
check("ноль при обычных 40 — проблема и одно письмо", () => {
  const [a, b] = run(healthy, [{ ok: true, count: 0 }, { ok: true, count: 0 }]);
  assert.match(a.healthIssue ?? "", /перестал отдавать события/);
  assert.deepEqual([a.notify, b.notify], ["problem", null]);
});
check("резкое падение: 5 вместо 40", () => {
  const a = assessHealth(healthy, { ok: true, count: 5 });
  assert.match(a.healthIssue ?? "", /резкое падение: 5 записей вместо обычных ~40/);
  assert.equal(a.notify, "problem");
});
check("обычные колебания и маленькие ленты — без оповещений", () => {
  assert.equal(assessHealth(healthy, { ok: true, count: 25 }).notify, null);
  assert.equal(assessHealth({ ...healthy, avgCount: 2 }, { ok: true, count: 0 }).healthIssue, null);
  assert.equal(assessHealth({ ...healthy, avgCount: 8 }, { ok: true, count: 1 }).healthIssue, null);
});
check("одна ошибка сети — без письма, вторая подряд — письмо, третья — без повтора", () => {
  const [a, b, c] = run(healthy, [{ ok: false, error: "сайт не ответил вовремя" }, { ok: false, error: "сайт не ответил вовремя" }, { ok: false, error: "сайт ответил кодом 500" }]);
  assert.deepEqual([a.notify, b.notify, c.notify], [null, "problem", null]);
  assert.match(c.healthIssue ?? "", /3 раза подряд: сайт ответил кодом 500/);
  assert.equal(c.avgCount, 40, "ошибка не портит обычный уровень");
});
check("восстановление — письмо «снова работает»", () => {
  const [, , a] = run(healthy, [{ ok: true, count: 0 }, { ok: true, count: 0 }, { ok: true, count: 38 }]);
  assert.deepEqual([a.healthIssue, a.notify], [null, "recovered"]);
});
check("смена проблемы (ошибки → ноль записей) — новое письмо", () => {
  const [, b, c] = run(healthy, [{ ok: false, error: "x" }, { ok: false, error: "x" }, { ok: true, count: 0 }]);
  assert.equal(b.notify, "problem");
  assert.equal(c.notify, "problem");
});
check("во время проблемы обычный уровень снижается медленно", () => {
  const a = assessHealth(healthy, { ok: true, count: 0 });
  assert.ok((a.avgCount ?? 0) > 35, String(a.avgCount));
});

console.log(failed ? `Не прошло: ${failed}` : "Все проверки прошли");
process.exit(failed ? 1 : 0);
