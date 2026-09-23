import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifySessionToken } from "@/lib/auth";

export default async function proxy(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const username = await verifySessionToken(token);

  if (!username) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/login|_next/static|_next/image|favicon.ico).*)"],
};
