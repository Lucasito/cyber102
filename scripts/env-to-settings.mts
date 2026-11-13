// Перенос настроек ИИ из переменных окружения (.env) в настройки админки (таблица Setting).
// Заполняет только пустые поля; значения ключей не выводит. Запуск: npx tsx scripts/env-to-settings.mts
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }) });
const row = await db.setting.findUnique({ where: { key: "ai" } });
const ai = { ...((row?.value as Record<string, unknown> | null) ?? {}) };

const moves: [string, string][] = [
  ["gigachatAuthKey", "GIGACHAT_AUTH_KEY"],
  ["gigachatScope", "GIGACHAT_SCOPE"],
  ["gigachatModel", "GIGACHAT_MODEL"],
  ["llmApiUrl", "LLM_API_URL"],
  ["llmApiKey", "LLM_API_KEY"],
  ["llmModel", "LLM_MODEL"],
];
for (const [field, env] of moves) {
  const value = process.env[env];
  if (value && !ai[field]) {
    ai[field] = value;
    console.log(`${env} → ${field}`);
  } else console.log(`${env}: ${value ? "в настройках уже задано" : "нет в .env"}`);
}
await db.setting.upsert({ where: { key: "ai" }, create: { key: "ai", value: ai }, update: { value: ai } });
await db.$disconnect();
