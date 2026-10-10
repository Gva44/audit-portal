import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { getSessionUser } from "@/lib/session";

// [id] is the username (work email), URL-encoded.

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getSessionUser(request);
  if (admin?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const username = decodeURIComponent((await params).id).toLowerCase();
  const body = await request.json().catch(() => ({}));

  if (typeof body.password === "string" && body.password) {
    await sql`update users set password_hash = ${await hashPassword(body.password)} where username = ${username}`;
  }
  if (body.role === "admin" || body.role === "user") {
    if (body.role === "user" && username === admin.username) {
      return NextResponse.json({ error: "You cannot remove your own admin role" }, { status: 400 });
    }
    await sql`update users set role = ${body.role} where username = ${username}`;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getSessionUser(request);
  if (admin?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const username = decodeURIComponent((await params).id).toLowerCase();
  if (username === admin.username) {
    return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
  }
  // Answers they generated keep their history; the attribution is cleared.
  await sql`update questions set generated_by = null where generated_by = ${username}`;
  await sql`delete from users where username = ${username}`;
  return NextResponse.json({ ok: true });
}
