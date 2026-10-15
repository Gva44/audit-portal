import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { AUTH_COOKIE, createSessionToken } from "@/lib/auth";

const STATE_COOKIE = "audit_portal_oauth_state";

function fail(request: NextRequest, error: string) {
  const response = NextResponse.redirect(new URL(`/login?error=${error}`, request.url));
  response.cookies.delete(STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(request, "google_not_configured");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const [expectedState, next] = (request.cookies.get(STATE_COOKIE)?.value ?? "").split("|");
  if (!code || !state || !expectedState || state !== expectedState) return fail(request, "google_failed");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: new URL("/api/auth/google/callback", request.url).toString(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail(request, "google_failed");
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
  if (!accessToken) return fail(request, "google_failed");

  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!infoRes.ok) return fail(request, "google_failed");
  const info = (await infoRes.json()) as { email?: string; email_verified?: boolean };
  const email = info.email?.toLowerCase();
  const allowedDomain = (process.env.GOOGLE_ALLOWED_DOMAIN || "newvest.my").toLowerCase();
  if (!email || !info.email_verified || !email.endsWith(`@${allowedDomain}`)) {
    return fail(request, "google_wrong_domain");
  }

  // Only people an administrator has added can sign in — a company Google account alone
  // is not enough.
  const rows = await sql`select username from users where username = ${email}`;
  if (!rows[0]) return fail(request, "not_registered");

  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const response = NextResponse.redirect(new URL(target, request.url));
  response.cookies.delete(STATE_COOKIE);
  response.cookies.set(AUTH_COOKIE, await createSessionToken(email), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
