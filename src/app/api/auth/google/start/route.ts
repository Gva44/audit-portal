import { NextRequest, NextResponse } from "next/server";

const GOOGLE_STATE_COOKIE = "audit_portal_oauth_state";

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/login?error=google_not_configured", request.url));
  }

  const state = crypto.randomUUID();
  const next = request.nextUrl.searchParams.get("next") || "/dashboard";
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", new URL("/api/auth/google/callback", request.url).toString());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  const domain = process.env.GOOGLE_ALLOWED_DOMAIN || "newvest.my";
  url.searchParams.set("hd", domain);

  const response = NextResponse.redirect(url);
  // The state (and where to land afterwards) travel in a short-lived cookie so the
  // callback can confirm the request really started here.
  response.cookies.set(GOOGLE_STATE_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
