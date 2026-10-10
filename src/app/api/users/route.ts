import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { getSessionUser } from "@/lib/session";

function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "a").replace(/\//g, "b").replace(/=/g, "");
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await sql`
    select username, display_name, role, (password_hash <> '') as has_password, created_at
    from users order by created_at asc
  `;
  return NextResponse.json({ users: rows });
}

// Creates a login. Username is the person's work email. Leave the password blank for a
// Google-only account, or to get a generated one returned once for you to pass on.
export async function POST(request: NextRequest) {
  const admin = await getSessionUser(request);
  if (admin?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const role = body.role === "admin" ? "admin" : "user";
  if (!username || !displayName) {
    return NextResponse.json({ error: "Email and name are required" }, { status: 400 });
  }
  if (/\s/.test(username)) return NextResponse.json({ error: "Invalid username" }, { status: 400 });

  let password: string | null = null;
  if (typeof body.password === "string" && body.password) password = body.password;
  else if (body.generatePassword === true) password = generatePassword();
  const passwordHash = password ? await hashPassword(password) : "";

  const existing = await sql`select 1 from users where username = ${username}`;
  if (existing[0]) return NextResponse.json({ error: "That user already exists" }, { status: 409 });

  await sql`
    insert into users (username, display_name, password_hash, role)
    values (${username}, ${displayName}, ${passwordHash}, ${role})
  `;
  return NextResponse.json({ ok: true, generatedPassword: body.generatePassword === true ? password : null });
}
