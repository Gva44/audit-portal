import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { generateAnswer } from "@/lib/questions";
import { AUTH_COOKIE, verifySessionToken } from "@/lib/auth";
import { fetchQuestions } from "@/lib/question-queries";

export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const generatedBy = await verifySessionToken(request.cookies.get(AUTH_COOKIE)?.value);

  const existing = await sql`
    select q.question_text, q.row_data, q.expected_evidence, q.document_id, d.client_id
    from questions q
    join documents d on d.id = q.document_id
    where q.id = ${id}
  `;
  const question = existing[0];
  if (!question) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const generated = await generateAnswer({
      questionText: question.question_text as string,
      rowData: question.row_data as Record<string, string> | null,
      expectedEvidence: question.expected_evidence as string | null,
      documentId: question.document_id as string,
      clientId: (question.client_id as string | null) ?? null,
    });
    await sql`
      update questions
      set answer_text = ${generated.comments},
          citations = ${JSON.stringify(generated.citations)}::jsonb,
          response_value = ${generated.responseValue},
          confidence_level = ${generated.confidenceLevel},
          confidence_score = ${generated.confidenceScore},
          score = ${generated.score},
          suggested_action = ${generated.suggestedAction},
          comparison_status = ${generated.comparisonStatus},
          comparison_note = ${generated.comparisonNote},
          recommendation = ${generated.recommendation},
          source_scope = ${generated.sourceScope},
          embedding = ${generated.embeddingLiteral}::vector,
          prior_question_id = ${generated.priorQuestionId},
          generated_by = ${generatedBy},
          answer_status = 'ok', answer_error = null
      where id = ${id}
    `;
    return NextResponse.json({ question: (await fetchQuestions({ questionId: id }))[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error generating answer";
    await sql`
      update questions
      set answer_status = 'failed', answer_error = ${message}, generated_by = ${generatedBy}
      where id = ${id}
    `;
    return NextResponse.json({ question: (await fetchQuestions({ questionId: id }))[0] }, { status: 500 });
  }
}
