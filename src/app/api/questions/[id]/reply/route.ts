import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { fetchQuestions } from "@/lib/question-queries";
import { asReplyStatus, classifyReply } from "@/lib/reply";
import { checkAiAccess, logAiUsage } from "@/lib/ai-control";
import { asAllowed, clientResponse, resolveAllowed } from "@/lib/answer-format";

export const maxDuration = 60;

// Saves what the client wrote back about one of our answers. The reply is kept separate from our
// answer. Unless the person picks the status, the AI reads the reply next to our answer and sets
// agreed / different / client query / unclear, with a one-line note for IT.
//   { reply: "text" }                 save (and classify) a reply
//   { reply: "text", status: "..." }  save with the status the person chose
//   { status: "..." }                 change only the status of the saved reply
//   { reply: "" }                     remove the reply
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const rows = await sql`
    select q.question_text, q.response_value, q.answer_text, q.client_reply,
           d.allowed_answers, d.column_headers, d.column_config
    from questions q join documents d on d.id = q.document_id
    where q.id = ${id}
  `;
  const q = rows[0];
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const hasReply = typeof body.reply === "string";
  const reply = hasReply ? (body.reply as string).trim() : null;
  const chosen = asReplyStatus(body.status);

  if (hasReply && reply === "") {
    await sql`
      update questions set client_reply = null, reply_status = null, reply_note = null, reply_by = null, reply_at = null
      where id = ${id}
    `;
    return NextResponse.json({ question: (await fetchQuestions({ questionId: id }))[0] });
  }
  if (reply && reply.length > 4000) {
    return NextResponse.json({ error: "That reply is too long (4,000 characters at most)." }, { status: 400 });
  }

  // Only the status changed.
  if (!hasReply) {
    if (!chosen || !q.client_reply) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    await sql`update questions set reply_status = ${chosen}, reply_by = ${user.username}, reply_at = now() where id = ${id}`;
    return NextResponse.json({ question: (await fetchQuestions({ questionId: id }))[0] });
  }

  let status = chosen;
  let note: string | null = null;
  if (!status) {
    const access = await checkAiAccess(user, "assist");
    if (access.ok) {
      const allowed = resolveAllowed(
        asAllowed(q.allowed_answers),
        (q.column_headers as string[] | null) ?? null,
        ((q.column_config as { responseCol?: number | null } | null)?.responseCol ?? null)
      );
      const result = await classifyReply({
        question: q.question_text as string,
        ourResponse: clientResponse(q.response_value as string | null, allowed) || String(q.response_value ?? ""),
        ourRemark: (q.answer_text as string | null) ?? "",
        reply: reply as string,
      });
      await logAiUsage(user.username, "assistant", result.usage);
      status = result.status;
      note = result.note;
    } else {
      status = "unclear"; // no AI access: IT sets the status by hand
    }
  }

  await sql`
    update questions
    set client_reply = ${reply}, reply_status = ${status}, reply_note = ${note},
        reply_by = ${user.username}, reply_at = now()
    where id = ${id}
  `;
  return NextResponse.json({ question: (await fetchQuestions({ questionId: id }))[0] });
}
