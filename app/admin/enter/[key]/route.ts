import { ADMIN_COOKIE, ADMIN_MAX_AGE, checkEnterKey, sessionValue } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/** Вход в админку по секретной ссылке. Неверный ключ — 404, как для любой несуществующей страницы. */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!checkEnterKey(decodeURIComponent(key))) return new Response("Not found", { status: 404 });
  const secure = new URL(request.url).protocol === "https:" || (process.env.PUBLIC_URL ?? "").startsWith("https:");
  const cookie = [`${ADMIN_COOKIE}=${sessionValue()}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${ADMIN_MAX_AGE}`, secure ? "Secure" : ""].filter(Boolean).join("; ");
  return new Response(null, { status: 303, headers: { Location: "/admin", "Set-Cookie": cookie, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
