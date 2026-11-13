// Пробный разбор источников без записи в базу: npm run sources:preview -- код1 код2
import "dotenv/config";
import { previewSource } from "../lib/server/collect/index.ts";
import { db } from "../lib/server/db.ts";
for (const code of process.argv.slice(2)) {
  const s = await db.source.findUniqueOrThrow({ where: { code } });
  try {
    const p = await previewSource(s.id);
    console.log(`${code}: записей в ленте ${p.feedItems}, строк ${p.rows.length}, годных ${p.rows.filter((r) => r.ok).length}, пропущено ${p.skipped.length}, ток. ${p.tokens} (${p.costRub.toFixed(2)} ₽)${p.message ? " — " + p.message : ""}`);
    for (const r of p.rows.slice(0, 4)) console.log("  ", r.ok ? "✓" : "✗", r.title, r.startsAt ?? "", r.venue ?? "", r.city ?? "", r.error ?? r.issues.join("; "));
    for (const k of p.skipped.slice(0, 3)) console.log("   пропуск:", k.title.slice(0, 60), "—", k.reason);
  } catch (e) { console.log(code, "ОШИБКА:", e instanceof Error ? e.message : e); }
}
await db.$disconnect();
process.exit(0);
