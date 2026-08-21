import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await sql`select drive_web_link from documents where id = ${id}`;
  const doc = rows[0];
  if (!doc?.drive_web_link) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.redirect(doc.drive_web_link as string);
}
