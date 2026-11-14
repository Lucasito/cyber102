// Снимок реальной афиши для тестовых данных: npm run data:snapshot [-- https://адрес-афиши]
// Берёт актуальные события из публичного API (по умолчанию — развёрнутая афиша) и пишет data/real-events.json.
// В снимок попадают только события с первоисточником и площадкой; выдуманных событий в тестовых данных нет.
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { fetchSnapshot, SNAPSHOT_API, SNAPSHOT_FILE } from "../lib/real-data.ts";

const base = process.argv.find((a) => /^https?:\/\//.test(a)) ?? SNAPSHOT_API;
const snap = await fetchSnapshot(base);
await mkdir(new URL(".", SNAPSHOT_FILE), { recursive: true });
// По строке на событие: снимок читается и сравнивается в git построчно
const body = `{"takenAt":${JSON.stringify(snap.takenAt)},"from":${JSON.stringify(snap.from)},"events":[\n${snap.events.map((e) => JSON.stringify(e)).join(",\n")}\n]}\n`;
await writeFile(SNAPSHOT_FILE, body);
const sources = new Set(snap.events.map((e) => e.source));
console.log(`Снимок ${snap.takenAt.slice(0, 10)}: ${snap.events.length} событий из ${sources.size} источников → data/real-events.json`);
