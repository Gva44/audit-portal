import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await sql`
    select q.id, q.document_id, q.position, q.question_text, q.row_data, q.answer_text, q.citations,
           q.response_value, q.confidence_level, q.confidence_score, q.suggested_action,
           q.prior_question_id, prior.question_text as prior_question_text,
           q.answer_status, q.answer_error, q.created_at
    from questions q
    left join questions prior on prior.id = q.prior_question_id
    where q.document_id = ${id}
    order by q.position asc
  `;
  return NextResponse.json({ questions: rows });
}
