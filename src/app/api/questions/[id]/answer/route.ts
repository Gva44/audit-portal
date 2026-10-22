import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { generateAnswer } from "@/lib/questions";
import { getSessionUser } from "@/lib/session";
import { checkAiAccess, logAiUsage } from "@/lib/ai-control";
import { fetchQuestions } from "@/lib/question-queries";
import { asFormat, DEFAULT_FORMAT } from "@/lib/answer-format";

export const maxDuration = 120;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser(request);
  const access = await checkAiAccess(user, "generate");
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: access.status });
  const generatedBy = user!.username;

  const body = await request.json().catch(() => ({}));
  const existing = await sql`
    select q.question_text, q.row_data, q.expected_evidence, q.document_id, d.client_id, d.answer_format as doc_format
    from questions q
    join documents d on d.id = q.document_id
    where q.id = ${id}
  `;
  const question = existing[0];
  if (!question) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The format the person picked, else the questionnaire's default.
  const format = asFormat(body?.format) ?? asFormat(question.doc_format) ?? DEFAULT_FORMAT;

  try {
    const generated = await generateAnswer({
      format,
      questionText: question.question_text as string,
      rowData: question.row_data as Record<string, string> | null,
      expectedEvidence: question.expected_evidence as string | null,
      documentId: question.document_id as string,
      clientId: (question.client_id as string | null) ?? null,
    });
    await logAiUsage(generatedBy, "answer", generated.usage);
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
          gap_note = ${generated.gapNote},
          source_scope = ${generated.sourceScope},
          embedding = ${generated.embeddingLiteral}::vector,
          prior_question_id = ${generated.priorQuestionId},
          previous_response_value = response_value,
          previous_answer_text = answer_text,
          edited_by = null, edited_at = null, updated_at = now(),
          generated_by = ${generatedBy},
          model_used = ${generated.modelUsed},
          answer_format = ${format},
          answer_status = 'ok', answer_error = null
      where id = ${id}
    `;
    return NextResponse.json({ question: (await fetchQuestions({ questionId: id }))[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error generating answer";
    await sql`
      update questions
      set answer_status = 'failed', answer_error = ${message}, generated_by = ${generatedBy}, updated_at = now()
      where id = ${id}
    `;
    return NextResponse.json({ question: (await fetchQuestions({ questionId: id }))[0] }, { status: 500 });
  }
}
