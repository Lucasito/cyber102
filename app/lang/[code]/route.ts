import { LANG_COOKIE } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** Переключение языка: /lang/ba или /lang/ru → cookie на год и возврат на страницу, откуда пришли. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const lang = code === "ba" ? "ba" : "ru";
  const url = new URL(request.url);
  // Возвращаем только на свой сайт (защита от открытого редиректа)
  const back = url.searchParams.get("back") ?? "/";
  const location = back.startsWith("/") && !back.startsWith("//") ? back : "/";
  return new Response(null, {
    status: 303,
    headers: { Location: location, "Set-Cookie": `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`, "Cache-Control": "no-store" },
  });
}
