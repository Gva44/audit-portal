import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { deleteFile } from "@/lib/drive";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await sql`
    select id, filename, category, notes, mime_type, file_size,
           extracted_text, extraction_status, extraction_error, created_at
    from documents
    where id = ${id}
  `;
  const document = rows[0];
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ document });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await sql`delete from documents where id = ${id} returning drive_file_id`;
  const deleted = rows[0];
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await deleteFile(deleted.drive_file_id as string);
  } catch (err) {
    console.error(`Failed to delete Drive file ${deleted.drive_file_id}:`, err);
  }

  return NextResponse.json({ ok: true });
}
