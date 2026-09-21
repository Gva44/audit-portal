import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getFileBuffer } from "@/lib/drive";
import { parseAndSaveQuestions } from "@/lib/questions";

// For questionnaire documents uploaded before this feature existed (or whose automatic
// extraction failed) — re-fetches the original file from Drive and parses questions from
// it (structured table parsing needs the original file, not just the flattened text
// already stored from upload).
export const maxDuration = 30;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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
    const count = await parseAndSaveQuestions(
      id,
      buffer,
      doc.mime_type as string,
      (doc.extracted_text as string | null) ?? ""
    );
    return NextResponse.json({ count });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error extracting questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
