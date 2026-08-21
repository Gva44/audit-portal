import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { extractQuestions, saveExtractedQuestions } from "@/lib/questions";

// For questionnaire documents uploaded before this feature existed (or whose automatic
// extraction failed) — parses questions from the already-stored extracted text without
// needing to re-upload the file.
export const maxDuration = 30;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const rows = await sql`
    select category, extracted_text from documents where id = ${id}
  `;
  const doc = rows[0];
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.category !== "questionnaire") {
    return NextResponse.json({ error: "Document is not a questionnaire" }, { status: 400 });
  }
  const extractedText = doc.extracted_text as string | null;
  if (!extractedText?.trim()) {
    return NextResponse.json({ error: "No extracted text available for this document" }, { status: 400 });
  }

  const questions = await extractQuestions(extractedText);
  await saveExtractedQuestions(id, questions);

  return NextResponse.json({ count: questions.length });
}
