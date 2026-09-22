import { sql } from "./db";
import { generateEmbedding, toVectorLiteral } from "./embeddings";
import { getGemini } from "./gemini";
import { parseDocxTable, parseXlsxTable, toQuestionRows } from "./questionnaire-table";
import { XLSX_MIME } from "./extract";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

export async function saveStructuredQuestions(
  documentId: string,
  rows: { questionText: string; rowData: Record<string, string> }[]
): Promise<void> {
  await Promise.all(
    rows.map(
      (r, i) => sql`
        insert into questions (document_id, position, question_text, row_data)
        values (${documentId}, ${i}, ${r.questionText}, ${JSON.stringify(r.rowData)}::jsonb)
      `
    )
  );
}

// Tries structured table parsing first (preserves the original column layout for export
// and gives per-question evidence context) and only falls back to AI-based extraction
// from flattened text when the file isn't a table (e.g. PDFs, or a docx/xlsx that turns
// out not to contain one). Structured parsing needs zero AI calls, so it's immune to
// provider quota/cost issues entirely.
export async function parseAndSaveQuestions(
  documentId: string,
  buffer: Buffer,
  mimeType: string,
  extractedText: string
): Promise<number> {
  let table = null;
  if (mimeType === XLSX_MIME) {
    table = await parseXlsxTable(buffer);
  } else if (mimeType === DOCX_MIME) {
    table = await parseDocxTable(buffer);
  }

  if (table) {
    const rows = toQuestionRows(table);
    if (rows.length > 0) {
      await sql`update documents set column_headers = ${JSON.stringify(table.headers)}::jsonb where id = ${documentId}`;
      await saveStructuredQuestions(documentId, rows);
      return rows.length;
    }
  }

  if (extractedText.trim()) {
    const questions = await extractQuestions(extractedText);
    await saveExtractedQuestions(documentId, questions);
    return questions.length;
  }

  return 0;
}

// Looks for a column that names required evidence (common in bank DD questionnaires,
// e.g. "Documents / Information Needed") to give the model extra context on what proof
// is expected, beyond the question text itself.
const EVIDENCE_HEADER_PATTERN = /evidence|document.*need|information.*need|required/i;

function findExpectedEvidence(rowData: Record<string, string> | null | undefined): string | null {
  if (!rowData) return null;
  for (const [header, value] of Object.entries(rowData)) {
    if (EVIDENCE_HEADER_PATTERN.test(header) && value.trim()) return value.trim();
  }
  return null;
}

const MAX_RETRIEVED_DOCS = 5;
const MAX_EXCERPT_CHARS = 3000;

export type Citation = { id: string; filename: string };

export type GeneratedAnswer = {
  responseValue: string;
  comments: string;
  citations: Citation[];
  confidenceLevel: "high" | "medium" | "low";
  confidenceScore: number;
  suggestedAction: string | null;
  // The question's own embedding (for persisting so *future* similar questions, e.g. next
  // year's questionnaire, can find this one), and which prior question (if any) was used
  // as reference context — both null when there's nothing to store.
  embeddingLiteral: string;
  priorQuestionId: string | null;
};

// How close two questions' meanings must be (cosine similarity, 0-1) to treat one as a
// genuine "this was asked before" match rather than just a topically related question.
// Deliberately high since a wrong match would feed the model an answer to a different
// question — worth tuning based on real results once this has real year-over-year data.
const PRIOR_MATCH_THRESHOLD = 0.85;

function clampConfidenceScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeConfidenceLevel(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

export async function generateAnswer(
  questionText: string,
  rowData?: Record<string, string> | null,
  currentQuestionId?: string | null
): Promise<GeneratedAnswer> {
  const vectorLiteral = toVectorLiteral(await generateEmbedding(questionText));

  // Hybrid retrieval: blend keyword relevance (ts_rank) with semantic similarity, the
  // same weighting used for the search bar (src/app/api/search/route.ts), so a document
  // that's an exact terminology match but a weaker semantic match still surfaces.
  const rows = await sql`
    select id, filename, extracted_text,
           (
             coalesce(ts_rank(
               to_tsvector('english', coalesce(filename, '') || ' ' || coalesce(extracted_text, '')),
               plainto_tsquery('english', ${questionText})
             ), 0) * 0.4
             + coalesce(1 - (embedding <=> ${vectorLiteral}::vector), 0) * 0.6
           ) as score
    from documents
    where category in ('policy', 'evidence')
      and embedding is not null
      and extracted_text is not null
    order by score desc
    limit ${MAX_RETRIEVED_DOCS}
  `;

  // Automatically finds a prior answer to a near-identical question from *any* previous
  // questionnaire (typically last year's, but not limited to that) — no manual linking
  // between files needed. Excludes the current question itself when it already has an id.
  const priorRows = await sql`
    select id, question_text, response_value, answer_text
    from questions
    where answer_status = 'ok'
      and embedding is not null
      and (${currentQuestionId}::uuid is null or id != ${currentQuestionId}::uuid)
      and (1 - (embedding <=> ${vectorLiteral}::vector)) > ${PRIOR_MATCH_THRESHOLD}
    order by embedding <=> ${vectorLiteral}::vector
    limit 1
  `;
  const priorMatch = priorRows[0] ?? null;

  if (rows.length === 0) {
    return {
      responseValue: "No",
      comments: "No supporting policy found – requires manual review.",
      citations: [],
      confidenceLevel: "low",
      confidenceScore: 0,
      suggestedAction: "Upload a policy or evidence document covering this control area.",
      embeddingLiteral: vectorLiteral,
      priorQuestionId: null,
    };
  }

  const excerpts = rows
    .map(
      (r) =>
        `[doc id="${r.id}" filename="${r.filename}"]\n${String(r.extracted_text).slice(0, MAX_EXCERPT_CHARS)}\n[/doc]`
    )
    .join("\n\n");

  const expectedEvidence = findExpectedEvidence(rowData);
  const userContent = [
    `Excerpts:\n\n${excerpts}`,
    expectedEvidence ? `Evidence the client expects for this question: ${expectedEvidence}` : null,
    priorMatch
      ? `A previous questionnaire asked a near-identical question and was answered as follows ` +
        `(reuse or adapt this ONLY if the excerpts above still support it — if the excerpts contradict ` +
        `it or no longer support it, answer fresh from the excerpts instead):\n` +
        `Previous question: ${priorMatch.question_text}\n` +
        `Previous response: ${priorMatch.response_value}\n` +
        `Previous comments: ${priorMatch.answer_text}`
      : null,
    `Question: ${questionText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const parsed = await generateJson<{
    response?: unknown;
    comments?: unknown;
    confidenceLevel?: unknown;
    confidenceScore?: unknown;
    suggestedAction?: unknown;
    supportingDocumentIds?: unknown;
  }>(
    "You are an IT/security audit compliance assistant answering a due-diligence questionnaire " +
      "question for a banking client, using ONLY the provided policy/evidence excerpts. Never invent " +
      "facts not present in the excerpts, and never include passwords, API keys, or other secrets in " +
      "your answer even if they appear in the excerpts.\n\n" +
      "Determine:\n" +
      '- response: "Yes" if the excerpts clearly and fully support a positive answer, "Partial" if they ' +
      'support some but not all aspects, "No" if excerpts contradict or a negative answer is clearly ' +
      'implied, "NA" if the question does not apply, or a short free-text value if the question is not ' +
      "a yes/no/na question (e.g. asks for a description, a number, or a list).\n" +
      "- comments: a concise (max 200 words), formal justification suitable for submission to a bank. " +
      "State the control/process in place, cite the specific document (and section/clause if " +
      "identifiable from the excerpt), and mention frequency, scope, or metrics where relevant. If " +
      'partial, state what is missing. If no evidence was found, use exactly: "No supporting policy ' +
      'found – requires manual review."\n' +
      "- confidenceLevel and confidenceScore (0 to 1): \"high\" (score >= 0.85) if at least 2 strong, " +
      'unambiguous evidence matches; "medium" (0.60-0.84) if at least one strong but incomplete match; ' +
      '"low" (< 0.60) if evidence is weak, absent, or the question represents a gap.\n' +
      '- suggestedAction: only when response is "No", "Partial", or confidence is low — a short, ' +
      'concrete next step (e.g. "Draft a policy covering X", "Update the Y policy to address Z"). ' +
      "Otherwise null.\n" +
      "If a previous answer to a near-identical question is provided below, treat it as reference " +
      "only — verify it against the current excerpts and never carry it forward if the excerpts no " +
      "longer support it.\n\n" +
      'Respond with JSON: {"response": string, "comments": string, "confidenceLevel": ' +
      '"high"|"medium"|"low", "confidenceScore": number, "suggestedAction": string|null, ' +
      '"supportingDocumentIds": string[]}. supportingDocumentIds must be a subset of the doc ids shown ' +
      "in the excerpts, limited to the ones that actually support the answer.",
    userContent
  );

  const responseValue = typeof parsed.response === "string" ? parsed.response.trim() : "";
  const comments = typeof parsed.comments === "string" ? parsed.comments.trim() : "";
  if (!responseValue || !comments) {
    throw new Error("Model response did not include a response and comments");
  }

  const supportingIds = new Set(
    Array.isArray(parsed.supportingDocumentIds) ? parsed.supportingDocumentIds : []
  );
  const citations: Citation[] = rows
    .filter((r) => supportingIds.has(r.id as string))
    .map((r) => ({ id: r.id as string, filename: r.filename as string }));

  return {
    responseValue,
    comments,
    citations,
    confidenceLevel: normalizeConfidenceLevel(parsed.confidenceLevel),
    confidenceScore: clampConfidenceScore(parsed.confidenceScore),
    suggestedAction: typeof parsed.suggestedAction === "string" ? parsed.suggestedAction.trim() : null,
    embeddingLiteral: vectorLiteral,
    priorQuestionId: priorMatch ? (priorMatch.id as string) : null,
  };
}
