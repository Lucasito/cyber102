import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { getLang } from "@/lib/server/lang";

export const metadata: Metadata = {
  title: { default: "Афиша культуры Башкортостана", template: "%s — Афиша культуры Башкортостана" },
  description: "Спектакли, концерты, выставки и музеи Республики Башкортостан. Поиск по дате, городу, цене и возрасту, умный помощник.",
  metadataBase: process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL) : undefined,
};

export const viewport: Viewport = { themeColor: "#0b7a55" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Язык страницы — для экранных чтецов и переносов: башкирский интерфейс — lang="ba"
  return (
    <html lang={await getLang()}>
      <body>{children}</body>
    </html>
  );
}
