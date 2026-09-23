import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { AUTH_COOKIE, createSessionToken, verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  let username: unknown;
  let password: unknown;
  try {
    const body = await request.json();
    username = body.username;
    password = body.password;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof username !== "string" || typeof password !== "string" || !username.trim()) {
    return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
  }

  const rows = await sql`select username, password_hash from users where username = ${username.trim().toLowerCase()}`;
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash as string))) {
    return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
  }

  const token = await createSessionToken(user.username as string);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
