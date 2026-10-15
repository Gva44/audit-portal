import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { fetchQuestions } from "@/lib/question-queries";

// Replaces an answer's response and comments with wording a person chose (typed by hand
// or taken from the AI's rewrite). The score is deliberately left alone: it reflects the
// documents behind the answer, not how it is worded. The previous text is kept for undo.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user || !(user.canGenerate || user.canAssist)) {
    return NextResponse.json({ error: "You do not have permission to edit answers." }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const answerText = typeof body.answerText === "string" ? body.answerText.trim() : "";
  const responseValue = typeof body.responseValue === "string" ? body.responseValue.trim() : "";
  if (!answerText || !responseValue) {
    return NextResponse.json({ error: "Both the response and the comments are required." }, { status: 400 });
  }
  if (answerText.length > 6000 || responseValue.length > 300) {
    return NextResponse.json({ error: "That text is too long." }, { status: 400 });
  }

  const updated = await sql`
    update questions
    set previous_response_value = response_value,
        previous_answer_text = answer_text,
        response_value = ${responseValue},
        answer_text = ${answerText},
        answer_status = 'ok', answer_error = null,
        edited_by = ${user.username}, edited_at = now(), updated_at = now()
    where id = ${id}
    returning id
  `;
  if (!updated[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ question: (await fetchQuestions({ questionId: id }))[0] });
}
