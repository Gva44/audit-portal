import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { generateAnswer } from "@/lib/questions";

export const maxDuration = 30;

const RETURNING_COLUMNS = `
  id, document_id, position, question_text, row_data, answer_text, citations,
  response_value, confidence_level, confidence_score, suggested_action, prior_question_id,
  answer_status, answer_error, created_at
`;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await sql`select question_text, row_data from questions where id = ${id}`;
  const question = existing[0];
  if (!question) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const generated = await generateAnswer(
      question.question_text as string,
      question.row_data as Record<string, string> | null,
      id
    );
    const rows = await sql`
      update questions
      set answer_text = ${generated.comments},
          citations = ${JSON.stringify(generated.citations)}::jsonb,
          response_value = ${generated.responseValue},
          confidence_level = ${generated.confidenceLevel},
          confidence_score = ${generated.confidenceScore},
          suggested_action = ${generated.suggestedAction},
          embedding = ${generated.embeddingLiteral}::vector,
          prior_question_id = ${generated.priorQuestionId},
          answer_status = 'ok', answer_error = null
      where id = ${id}
      returning ${sql.unsafe(RETURNING_COLUMNS)}
    `;
    return NextResponse.json({ question: rows[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error generating answer";
    const rows = await sql`
      update questions
      set answer_status = 'failed', answer_error = ${message}
      where id = ${id}
      returning ${sql.unsafe(RETURNING_COLUMNS)}
    `;
    return NextResponse.json({ question: rows[0] }, { status: 500 });
  }
}
