import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifySessionToken } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function GET(request: NextRequest) {
  const username = await verifySessionToken(request.cookies.get(AUTH_COOKIE)?.value);
  if (!username) return NextResponse.json({ user: null }, { status: 401 });

  const rows = await sql`select username, display_name from users where username = ${username}`;
  const user = rows[0];
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  return NextResponse.json({ user: { username: user.username, displayName: user.display_name } });
}
