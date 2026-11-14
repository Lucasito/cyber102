// Тестовые данные — реальные события: npm run seed:real [-- --fresh]
//  без ключа — снимок из репозитория (data/real-events.json); --fresh — свежий снимок из публичного API афиши.
// Только локальная база. Прежние выдуманные тестовые события (источник demo, старые версии) удаляются.
import "dotenv/config";
import { db } from "../lib/server/db.ts";
import { fetchSnapshot, loadSnapshot, readSnapshotFile } from "../lib/real-data.ts";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Отказ: база не локальная. Продакшн наполняется сборщиком из источников, а не снимком.");
  process.exit(1);
}
const legacy = await db.event.deleteMany({ where: { sources: { some: { source: "demo" } } } });
if (legacy.count) console.log(`Удалено выдуманных тестовых событий прежних версий: ${legacy.count}`);
const snap = process.argv.includes("--fresh") ? await fetchSnapshot() : await readSnapshotFile();
const r = await loadSnapshot(db, snap);
console.log(`Снимок от ${snap.takenAt.slice(0, 10)}: загружено ${r.created} событий из ${r.sources} источников, отклонено ${r.rejected} (прошедшие и вне РБ)`);
await db.$disconnect();
