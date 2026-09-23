import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { generateAnswer } from "@/lib/questions";
import { AUTH_COOKIE, verifySessionToken } from "@/lib/auth";

export const maxDuration = 30;

const RETURNING_COLUMNS = `
  id, document_id, position, question_text, row_data, answer_text, citations,
  response_value, confidence_level, confidence_score, suggested_action, prior_question_id,
  generated_by, answer_status, answer_error, created_at
`;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const generatedBy = await verifySessionToken(request.cookies.get(AUTH_COOKIE)?.value);

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
          generated_by = ${generatedBy},
          answer_status = 'ok', answer_error = null
      where id = ${id}
      returning ${sql.unsafe(RETURNING_COLUMNS)}
    `;
    return NextResponse.json({ question: rows[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error generating answer";
    const rows = await sql`
      update questions
      set answer_status = 'failed', answer_error = ${message}, generated_by = ${generatedBy}
      where id = ${id}
      returning ${sql.unsafe(RETURNING_COLUMNS)}
    `;
    return NextResponse.json({ question: rows[0] }, { status: 500 });
  }
}
