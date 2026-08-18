import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { presignGetUrl } from "@/lib/r2";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await sql`select r2_key, filename from documents where id = ${id}`;
  const doc = rows[0];
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = await presignGetUrl(doc.r2_key as string, doc.filename as string);
  return NextResponse.redirect(url);
}
