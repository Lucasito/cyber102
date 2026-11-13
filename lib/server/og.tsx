import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Картинки-превью для ссылок (Open Graph): генерация через next/og.
// Шрифт Inter в woff (next/og не понимает woff2) — латиница и кириллица, обычный и жирный.

export const OG_SIZE = { width: 1200, height: 630 };

let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 700; style: "normal" }[]> | null = null;

export function ogFonts() {
  fonts ??= Promise.all(
    (["latin", "latin-ext", "cyrillic", "cyrillic-ext"] as const).flatMap((subset) =>
      ([400, 700] as const).map(async (weight) => ({
        name: "Inter",
        data: await readFile(path.join(process.cwd(), "node_modules/@fontsource/inter/files", `inter-${subset}-${weight}-normal.woff`)),
        weight,
        style: "normal" as const,
      })),
    ),
  );
  return fonts;
}

/** Логотип как data-URL для <img> внутри картинки. */
let logo: Promise<string> | null = null;
export function ogLogo() {
  logo ??= readFile(path.join(process.cwd(), "public/brand/logo-512.png")).then((b) => `data:image/png;base64,${b.toString("base64")}`);
  return logo;
}

/** Общий макет превью: градиент бренда, логотип, заголовок, подзаголовок, строка фактов. */
export function OgLayout({ logoSrc, kicker, title, subtitle, facts }: { logoSrc: string; kicker: string; title: string; subtitle?: string; facts?: string[] }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 64,
        background: "linear-gradient(135deg, #1565C0 0%, #0B8F5A 100%)",
        color: "white",
        fontFamily: "Inter",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- next/og рисует только <img> */}
        <img src={logoSrc} width={72} height={72} style={{ borderRadius: 16 }} alt="" />
        <div style={{ fontSize: 30, fontWeight: 700, opacity: 0.95 }}>Афиша культуры Башкортостана</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 28, opacity: 0.85 }}>{kicker}</div>
        <div style={{ fontSize: title.length > 40 ? 60 : 76, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 32, opacity: 0.9 }}>{subtitle}</div>}
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 28 }}>
        {(facts ?? []).map((f) => (
          <div key={f} style={{ display: "flex", padding: "10px 22px", borderRadius: 999, background: "rgba(255,255,255,0.18)" }}>
            {f}
          </div>
        ))}
      </div>
    </div>
  );
}
