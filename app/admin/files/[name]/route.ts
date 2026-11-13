import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireAdmin } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/** Файлы для пользователей админки: образцы импорта и код воркеров Cloudflare. Только после входа. */
const FILES: Record<string, { file: string; type: string; role: "ADMIN" | "MODERATOR" }> = {
  "events-sample.csv": { file: "docs/samples/events-sample.csv", type: "text/csv; charset=utf-8", role: "MODERATOR" },
  "events-sample.json": { file: "docs/samples/events-sample.json", type: "application/json; charset=utf-8", role: "MODERATOR" },
  "telegram-proxy-worker.js": { file: "docs/telegram-proxy-worker.js", type: "text/javascript; charset=utf-8", role: "ADMIN" },
  "mail-relay-worker.js": { file: "docs/mail-relay-worker.js", type: "text/javascript; charset=utf-8", role: "ADMIN" },
};

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const f = FILES[name];
  if (!f) return new Response("Not found", { status: 404 });
  await requireAdmin(f.role);
  const body = await readFile(path.join(process.cwd(), f.file));
  // CSV — с BOM, чтобы Excel открыл кириллицу правильно
  const content = name.endsWith(".csv") ? Buffer.concat([Buffer.from("﻿"), body]) : body;
  return new Response(content, { headers: { "Content-Type": f.type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
