import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await sql`
    select id, document_id, position, question_text, row_data, answer_text, citations,
           response_value, confidence_level, confidence_score, suggested_action,
           answer_status, answer_error, created_at
    from questions
    where document_id = ${id}
    order by position asc
  `;
  return NextResponse.json({ questions: rows });
}
