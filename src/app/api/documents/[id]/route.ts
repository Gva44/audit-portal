import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { deleteFile } from "@/lib/drive";
import { asAllowed, asFormat } from "@/lib/answer-format";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await sql`
    select d.id, d.filename, d.category, d.notes, d.mime_type, d.file_size,
           d.extracted_text, d.extraction_status, d.extraction_error, d.created_at,
           d.client_id, c.name as client_name, d.column_headers, d.column_config, d.column_instructions,
           d.answer_format, d.allowed_answers, d.columns_confirmed
    from documents d
    left join clients c on c.id = d.client_id
    where d.id = ${id}
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

// Settings that shape the answers and the client file: Brief/Short, what the client's response
// column accepts, where the evidence goes, and "yes, those are the right columns".
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const rows = await sql`select column_config from documents where id = ${id} and category = 'questionnaire'`;
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const format = asFormat(body.answerFormat);
  const allowed = asAllowed(body.allowedAnswers);
  if (format) await sql`update documents set answer_format = ${format} where id = ${id}`;
  if (allowed) await sql`update documents set allowed_answers = ${allowed} where id = ${id}`;
  if (typeof body.columnsConfirmed === "boolean") {
    await sql`update documents set columns_confirmed = ${body.columnsConfirmed} where id = ${id}`;
  }

  // Where the answer goes in the client's file: a column index, or null to add a new column.
  // includeEvidence=false leaves document names out. Saving does not re-read the questions.
  if (body.columns && typeof body.columns === "object") {
    const cfg: Record<string, unknown> = { ...((rows[0].column_config as Record<string, unknown> | null) ?? {}) };
    const idx = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
    for (const key of ["responseCol", "commentsCol", "citationsCol"] as const) {
      if (key in body.columns) cfg[key] = idx(body.columns[key]);
    }
    if ("includeEvidence" in body.columns) cfg.includeEvidence = body.columns.includeEvidence !== false;
    await sql`update documents set column_config = ${JSON.stringify(cfg)}::jsonb where id = ${id}`;
  }
  return NextResponse.json({ ok: true });
}
