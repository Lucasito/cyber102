import { ImageResponse } from "next/og";
import { OG_SIZE, OgLayout, ogFonts, ogLogo } from "@/lib/server/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Афиша культуры Башкортостана";

/** Превью ссылки на сайт. */
export default async function Image() {
  const [fonts, logo] = await Promise.all([ogFonts(), ogLogo()]);
  return new ImageResponse(
    <OgLayout
      logoSrc={logo}
      kicker="Спектакли, концерты, выставки и музеи республики"
      title="Куда сходить в Башкортостане"
      subtitle="Умный помощник подберёт события по вашему запросу"
      facts={["Сайт", "MAX", "Telegram"]}
    />,
    { ...OG_SIZE, fonts },
  );
}
