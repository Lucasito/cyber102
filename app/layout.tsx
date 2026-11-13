import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Афиша культуры Башкортостана", template: "%s — Афиша культуры Башкортостана" },
  description: "Спектакли, концерты, выставки и музеи Республики Башкортостан. Поиск по дате, городу, цене и возрасту, умный помощник.",
  metadataBase: process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL) : undefined,
};

export const viewport: Viewport = { themeColor: "#0b7a55" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
