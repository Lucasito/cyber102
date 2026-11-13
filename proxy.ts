import { NextResponse, type NextRequest } from "next/server";

/** Передаём текущий путь в заголовке — для переключателя языка (вернуть на ту же страницу). */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-afisha-path", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!api|_next|brand|illustrations|widget|lang|admin|favicon|icon).*)"] };
