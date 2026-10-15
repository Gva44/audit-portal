import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { AUTH_COOKIE, verifySessionToken } from "@/lib/auth";
import { fetchQuestions } from "@/lib/question-queries";

// "Use last year's answer": copies the matched previous question's response, comments and
// evidence onto this question as-is. Regenerating restores a fresh AI answer.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await verifySessionToken(request.cookies.get(AUTH_COOKIE)?.value);

  const rows = await sql`
    update questions q
    set previous_response_value = q.response_value,
        previous_answer_text = q.answer_text,
        edited_by = null, edited_at = null, updated_at = now(),
        answer_text = p.answer_text,
        response_value = p.response_value,
        citations = p.citations,
        suggested_action = null,
        score = 8,
        confidence_level = 'high',
        confidence_score = 0.8,
        generated_by = ${user},
        answer_status = 'ok', answer_error = null
    from questions p
    where q.id = ${id} and p.id = q.prior_question_id and p.answer_status = 'ok'
    returning q.id
  `;
  if (!rows[0]) return NextResponse.json({ error: "No previous answer to reuse" }, { status: 400 });

  return NextResponse.json({ question: (await fetchQuestions({ questionId: id }))[0] });
}
