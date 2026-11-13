import { ImageResponse } from "next/og";
import { formatPrice, TZ } from "@/lib/format";
import { db } from "@/lib/server/db";
import { OG_SIZE, OgLayout, ogFonts, ogLogo } from "@/lib/server/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Событие афиши культуры Башкортостана";

/** Превью ссылки на событие: название, дата, площадка, цена, возраст. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const e = await db.event.findUnique({ where: { id: (await params).id }, include: { venue: true, category: true } });
  const [fonts, logo] = await Promise.all([ogFonts(), ogLogo()]);
  if (!e) return new ImageResponse(<OgLayout logoSrc={logo} kicker="Афиша" title="Событие не найдено" />, { ...OG_SIZE, fonts });
  const when = e.startsAt.toLocaleString("ru-RU", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return new ImageResponse(
    (
      <OgLayout
        logoSrc={logo}
        kicker={e.category?.name ?? "Событие"}
        title={e.title}
        subtitle={`${when[0].toUpperCase()}${when.slice(1)}${e.venue ? ` · ${e.venue.name}, ${e.venue.city}` : ""}`}
        facts={[formatPrice(e).replace("₽", "руб."), ...(e.ageLimit != null ? [`${e.ageLimit}+`] : []), ...(e.pushkinCard ? ["Пушкинская карта"] : [])]}
      />
    ),
    { ...OG_SIZE, fonts },
  );
}
