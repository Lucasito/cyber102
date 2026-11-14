// Первый запуск в docker compose (локально, на чистой машине): реальные события, если база пуста,
// и первый администратор, если пользователей нет (пароль печатается в лог один раз).
// Включается переменными BOOTSTRAP_EVENTS=1 и BOOTSTRAP_ADMIN=1 — на продакшн-сервере они не заданы.
// События — снимок реальной афиши (lib/real-data.ts): сначала свежий из публичного API, без сети — из репозитория.
// Выдуманных событий нет ни в каком режиме (ТЗ).
import "dotenv/config";
import { db } from "../lib/server/db.ts";
import { fetchSnapshot, loadSnapshot, readSnapshotFile } from "../lib/real-data.ts";
import { generatePassword, hashPassword } from "../lib/server/password.ts";

if (process.env.BOOTSTRAP_EVENTS === "1" && (await db.event.count()) === 0) {
  let snap;
  try {
    snap = await fetchSnapshot();
    console.log(`[bootstrap] свежий снимок реальной афиши: ${snap.events.length} событий`);
  } catch (e) {
    snap = await readSnapshotFile();
    console.log(`[bootstrap] API афиши недоступен (${e instanceof Error ? e.message : e}) — снимок из репозитория от ${snap.takenAt.slice(0, 10)}`);
  }
  const r = await loadSnapshot(db, snap);
  console.log(`[bootstrap] загружено реальных событий: ${r.created} из ${r.sources} источников (прошедшие пропущены: ${r.rejected})`);
}
if (process.env.BOOTSTRAP_ADMIN === "1" && (await db.adminUser.count()) === 0) {
  const password = generatePassword();
  await db.adminUser.create({ data: { login: "admin", name: "Администратор", role: "ADMIN", passwordHash: await hashPassword(password) } });
  console.log(`[bootstrap] администратор создан — вход: ${process.env.PUBLIC_URL ?? "http://localhost:3000"}/admin, логин admin, пароль ${password}`);
}
await db.$disconnect();
