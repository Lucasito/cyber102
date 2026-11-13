// Проверка подключения ИИ: npm run ai:check [-- "вопрос"]
// Провайдер — из .env (AI_PROVIDER / GIGACHAT_* / LLM_*).
// Запускается с --conditions=react-server, чтобы пакет server-only не мешал вне Next.
import "dotenv/config";
import { aiProviderName, chat } from "../lib/server/ai.ts";

const question = process.argv[2] ?? "Назови три театра Уфы одной строкой.";
console.log("Провайдер:", (await aiProviderName()) ?? "не настроен");
const started = Date.now();
console.log(await chat([{ role: "user", content: question }]));
console.log(`(${Date.now() - started} мс)`);
