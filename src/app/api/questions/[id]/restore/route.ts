import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { fetchQuestions } from "@/lib/question-queries";

// One-step undo: puts back the response and comments from before the last edit or regeneration.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user || !(user.canGenerate || user.canAssist)) {
    return NextResponse.json({ error: "You do not have permission to edit answers." }, { status: 403 });
  }
  const { id } = await params;
  const restored = await sql`
    update questions
    set response_value = previous_response_value,
        answer_text = previous_answer_text,
        previous_response_value = null, previous_answer_text = null,
        edited_by = null, edited_at = null, updated_at = now()
    where id = ${id} and previous_answer_text is not null
    returning id
  `;
  if (!restored[0]) return NextResponse.json({ error: "There is nothing to restore." }, { status: 400 });
  return NextResponse.json({ question: (await fetchQuestions({ questionId: id }))[0] });
}
