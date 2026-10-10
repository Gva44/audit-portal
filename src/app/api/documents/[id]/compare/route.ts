import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { generateEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { comparisonFromSimilarity, findPriorMatch } from "@/lib/questions";

// Compares this questionnaire's questions with the same client's earlier answered
// questionnaires using embeddings only (no answer-generation cost). Works through a
// limited batch per call so a large file can't hit the function time limit; the page
// calls it repeatedly until `remaining` reaches 0.
export const maxDuration = 60;

const BATCH_SIZE = 15;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const docRows = await sql`select client_id from documents where id = ${id} and category = 'questionnaire'`;
  const doc = docRows[0];
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const clientId = (doc.client_id as string | null) ?? null;
  if (!clientId) return NextResponse.json({ remaining: 0, comparable: false });

  const pending = await sql`
    select id, question_text, embedding is not null as has_embedding
    from questions
    where document_id = ${id} and comparison_status is null
    order by position asc
    limit ${BATCH_SIZE}
  `;

  for (const q of pending) {
    const vector = toVectorLiteral(await generateEmbedding(q.question_text as string));
    const match = await findPriorMatch(vector, clientId, id);
    const status = match ? comparisonFromSimilarity(match.similarity) : "new";
    await sql`
      update questions
      set embedding = ${vector}::vector,
          comparison_status = ${status},
          prior_question_id = ${match ? match.id : null}
      where id = ${q.id}
    `;
  }

  const remaining = await sql`select count(*)::int as n from questions where document_id = ${id} and comparison_status is null`;
  return NextResponse.json({ remaining: remaining[0].n as number, comparable: true });
}
