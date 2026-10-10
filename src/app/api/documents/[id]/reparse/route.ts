import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getFileBuffer } from "@/lib/drive";
import { interpretColumnInstructions, parseAndSaveQuestions } from "@/lib/questions";
import type { ColumnConfig } from "@/lib/questionnaire-table";

// Re-reads the questionnaire's questions using a different column setup — either explicit
// column picks from the page, or a plain-English note that is interpreted into columns.
// Replaces the document's existing questions (and any answers on them), so the page only
// offers this after confirming with the user.
export const maxDuration = 60;

function cleanConfig(raw: unknown): ColumnConfig {
  const c = (raw ?? {}) as Record<string, unknown>;
  const idx = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  return {
    sheet: typeof c.sheet === "string" && c.sheet ? c.sheet : null,
    headerRow: typeof c.headerRow === "number" && c.headerRow >= 1 ? Math.floor(c.headerRow) : null,
    questionCol: idx(c.questionCol),
    evidenceCol: idx(c.evidenceCol),
    responseCol: idx(c.responseCol),
    commentsCol: idx(c.commentsCol),
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const rows = await sql`
    select category, drive_file_id, mime_type, extracted_text from documents where id = ${id}
  `;
  const doc = rows[0];
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.category !== "questionnaire") {
    return NextResponse.json({ error: "Document is not a questionnaire" }, { status: 400 });
  }

  try {
    const buffer = await getFileBuffer(doc.drive_file_id as string);
    const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
    const config = instructions
      ? await interpretColumnInstructions(buffer, doc.mime_type as string, instructions)
      : cleanConfig(body.config);

    await sql`delete from questions where document_id = ${id}`;
    const count = await parseAndSaveQuestions(
      id,
      buffer,
      doc.mime_type as string,
      (doc.extracted_text as string | null) ?? "",
      config
    );
    await sql`
      update documents
      set column_config = ${JSON.stringify(config)}::jsonb,
          column_instructions = ${instructions || null}
      where id = ${id}
    `;
    return NextResponse.json({ count, config });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error re-reading questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
