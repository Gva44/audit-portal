import { sql } from "./db";
import { generateEmbedding, toVectorLiteral } from "./embeddings";
import { getGemini } from "./gemini";

// Question extraction and answer generation both use Gemini (already funded/working in
// this app). DeepSeek was the original plan for this step and is a fine swap later —
// see src/lib/deepseek.ts — but its API needs a paid balance with no free tier, so this
// runs on Gemini for now to avoid a hard dependency on that top-up.
const GENERATION_MODEL = "gemini-flash-latest";

async function generateJson<T>(systemInstruction: string, userContent: string): Promise<T> {
  const response = await getGemini().models.generateContent({
    model: GENERATION_MODEL,
    contents: [{ text: userContent }],
    config: { systemInstruction, responseMimeType: "application/json" },
  });
  const content = response.text;
  if (!content) throw new Error("Gemini returned an empty response");
  return JSON.parse(content) as T;
}

// Keeps extraction fast and within context comfortably even for large questionnaires;
// a doc longer than this would need chunking, not needed at this scale.
const MAX_QUESTIONNAIRE_INPUT_CHARS = 40000;

export async function extractQuestions(text: string): Promise<string[]> {
  const input = text.slice(0, MAX_QUESTIONNAIRE_INPUT_CHARS).trim();
  if (!input) return [];

  const parsed = await generateJson<{ questions?: unknown }>(
    "You extract individual questions from an audit/compliance questionnaire document. " +
      "Identify each distinct question or requirement a respondent needs to address, in the order " +
      "they appear. Questionnaires are often laid out as tables (e.g. columns for the question, " +
      "required evidence, and a yes/no/na response) that get flattened into plain text — treat each " +
      "numbered row's core question/statement as one item even if checkbox sub-items, evidence " +
      "requirements, or answer-column labels are interleaved with it; do not split one row into " +
      "multiple items and do not include the surrounding column headers or notes as items themselves. " +
      "Ignore section headers, instructions, and non-question text. " +
      'Respond with JSON: {"questions": string[]}. If no questions are found, return {"questions": []}.',
    input
  );

  const questions = parsed?.questions;
  if (!Array.isArray(questions)) {
    throw new Error("Model response did not include a valid questions array");
  }
  return questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0);
}

export async function saveExtractedQuestions(documentId: string, questions: string[]): Promise<void> {
  await Promise.all(
    questions.map(
      (questionText, i) => sql`
        insert into questions (document_id, position, question_text)
        values (${documentId}, ${i}, ${questionText})
      `
    )
  );
}

const MAX_RETRIEVED_DOCS = 5;
const MAX_EXCERPT_CHARS = 3000;

export type Citation = { id: string; filename: string };

export async function generateAnswer(
  questionText: string
): Promise<{ answer: string; citations: Citation[] }> {
  const vectorLiteral = toVectorLiteral(await generateEmbedding(questionText));

  const rows = await sql`
    select id, filename, extracted_text
    from documents
    where category in ('policy', 'evidence')
      and embedding is not null
      and extracted_text is not null
    order by embedding <=> ${vectorLiteral}::vector
    limit ${MAX_RETRIEVED_DOCS}
  `;

  if (rows.length === 0) {
    return {
      answer: "No policy or evidence documents are available yet to answer this question.",
      citations: [],
    };
  }

  const excerpts = rows
    .map(
      (r) =>
        `[doc id="${r.id}" filename="${r.filename}"]\n${String(r.extracted_text).slice(0, MAX_EXCERPT_CHARS)}\n[/doc]`
    )
    .join("\n\n");

  const parsed = await generateJson<{ answer?: unknown; supportingDocumentIds?: unknown }>(
    "You are an audit compliance assistant. Answer the audit questionnaire question using ONLY " +
      "the provided policy/evidence excerpts. If the excerpts don't contain enough information to answer " +
      "confidently, say so explicitly rather than guessing or inventing details. " +
      'Respond with JSON: {"answer": string, "supportingDocumentIds": string[]}. ' +
      "supportingDocumentIds must be a subset of the doc ids shown in the excerpts, limited to the ones " +
      "that actually support your answer.",
    `Excerpts:\n\n${excerpts}\n\nQuestion: ${questionText}`
  );

  const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  if (!answer) throw new Error("Gemini response did not include an answer");

  const supportingIds = new Set(
    Array.isArray(parsed.supportingDocumentIds) ? parsed.supportingDocumentIds : []
  );
  const citations: Citation[] = rows
    .filter((r) => supportingIds.has(r.id as string))
    .map((r) => ({ id: r.id as string, filename: r.filename as string }));

  return { answer, citations };
}
