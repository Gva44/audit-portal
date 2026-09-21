import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { generateAnswer } from "@/lib/questions";

export const maxDuration = 30;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await sql`select question_text, row_data from questions where id = ${id}`;
  const question = existing[0];
  if (!question) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const { answer, citations } = await generateAnswer(
      question.question_text as string,
      question.row_data as Record<string, string> | null
    );
    const rows = await sql`
      update questions
      set answer_text = ${answer}, citations = ${JSON.stringify(citations)}::jsonb,
          answer_status = 'ok', answer_error = null
      where id = ${id}
      returning id, document_id, position, question_text, answer_text, citations, answer_status, answer_error, created_at
    `;
    return NextResponse.json({ question: rows[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error generating answer";
    const rows = await sql`
      update questions
      set answer_status = 'failed', answer_error = ${message}
      where id = ${id}
      returning id, document_id, position, question_text, answer_text, citations, answer_status, answer_error, created_at
    `;
    return NextResponse.json({ question: rows[0] }, { status: 500 });
  }
}
