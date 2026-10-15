import { sql } from "./db";
import { generateEmbedding, toVectorLiteral } from "./embeddings";
import { getGemini } from "./gemini";
import { getDeepSeek, DEEPSEEK_MODEL } from "./deepseek";
import { buildTable, readGrid, toQuestionRows, type ColumnConfig, type QuestionRow } from "./questionnaire-table";
import { XLSX_MIME } from "./extract";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Question extraction (a rarely-used fallback — most questionnaires parse structurally
// with zero AI calls, see parseAndSaveQuestions below) stays on Gemini. Answer generation
// (the actual per-question DeepSeek generation) runs on DeepSeek instead — see generateJsonDeepSeek.
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

// DeepSeek's JSON mode requires the word "json" in the prompt (already present in every
// systemInstruction below) and has no structured-output schema like Gemini's, so this
// just parses whatever valid JSON comes back.
async function generateJsonDeepSeek<T>(systemInstruction: string, userContent: string): Promise<T> {
  // `thinking` is a DeepSeek-specific field the OpenAI SDK's types don't know about. With
  // thinking on, the model spends most of max_tokens reasoning first and a long prompt can
  // leave an empty answer; this task is extraction/classification, so reasoning isn't needed.
  const params: Parameters<ReturnType<typeof getDeepSeek>["chat"]["completions"]["create"]>[0] & {
    thinking: { type: "disabled" };
  } = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    max_tokens: 4096,
    thinking: { type: "disabled" },
  };
  let raw: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      raw = await getDeepSeek().chat.completions.create(params);
      break;
    } catch (err) {
      const status = (err as { status?: number }).status;
      const timedOut = /timed out|timeout|aborted/i.test(err instanceof Error ? err.message : "");
      const busy = timedOut || status === 429 || (status !== undefined && status >= 500);
      if (busy && (timedOut || attempt >= 2)) {
        throw new Error("DeepSeek is busy right now and did not answer in time. Please try again in a minute.");
      }
      if (!busy) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  const response = raw as {
    choices: { message?: { content?: string | null }; finish_reason?: string }[];
  };
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`DeepSeek returned an empty response (finish reason: ${response.choices[0]?.finish_reason ?? "unknown"})`);
  }
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

export async function saveStructuredQuestions(documentId: string, rows: QuestionRow[]): Promise<void> {
  await Promise.all(
    rows.map(
      (r, i) => sql`
        insert into questions (document_id, position, question_text, row_data, expected_evidence)
        values (${documentId}, ${i}, ${r.questionText}, ${JSON.stringify(r.rowData)}::jsonb, ${r.expectedEvidence})
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
  extractedText: string,
  config?: ColumnConfig | null
): Promise<number> {
  if (mimeType === XLSX_MIME || mimeType === DOCX_MIME) {
    const grid = await readGrid(buffer, mimeType, config?.sheet);
    const table = grid ? buildTable(grid.rows, config?.headerRow) : null;
    if (table) {
      const rows = toQuestionRows(table, config);
      if (rows.length > 0) {
        await sql`update documents set column_headers = ${JSON.stringify(table.headers)}::jsonb where id = ${documentId}`;
        await saveStructuredQuestions(documentId, rows);
        return rows.length;
      }
    }
  }

  if (extractedText.trim()) {
    const questions = await extractQuestions(extractedText);
    await saveExtractedQuestions(documentId, questions);
    return questions.length;
  }

  return 0;
}

// Turns the uploader's plain-English note ("questions are in column C, evidence in D, put
// answers in F, ignore the first two rows") into concrete column indexes, using the first
// few rows of the real sheet so "column C" can be checked against what's actually there.
export async function interpretColumnInstructions(
  buffer: Buffer,
  mimeType: string,
  instructions: string
): Promise<ColumnConfig> {
  const grid = await readGrid(buffer, mimeType);
  if (!grid) throw new Error("No table found in this file to apply the instructions to");

  const preview = grid.rows
    .slice(0, 8)
    .map((r, i) => `Row ${i + 1}: ` + r.map((c, j) => `[${j}] ${c.slice(0, 60)}`).join(" | "))
    .join("\n");

  const parsed = await generateJsonDeepSeek<Record<string, unknown>>(
    "You map a person's plain-English note about a questionnaire spreadsheet/table onto its columns. " +
      "Columns are shown as [index] with 0-based indexes (column A = 0, B = 1, C = 2 ...). Rows are 1-based. " +
      "Respond with JSON: {\"sheet\": string|null, \"headerRow\": number|null, \"questionCol\": number|null, " +
      "\"evidenceCol\": number|null, \"responseCol\": number|null, \"commentsCol\": number|null}. " +
      "questionCol = where the questions are; evidenceCol = where the evidence/documents expected is described; " +
      "responseCol/commentsCol = existing empty columns where a Yes/No/Partial/NA response and the justification " +
      "should be written. headerRow = the row holding the column titles. Use null for anything the note does not say.\n" +
      `Available sheets: ${grid.sheets.join(", ") || "(single table)"}`,
    `Table preview:\n${preview}\n\nNote from the user: ${instructions}`
  );

  const toIdx = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  return {
    sheet: typeof parsed.sheet === "string" && grid.sheets.includes(parsed.sheet) ? parsed.sheet : null,
    headerRow: typeof parsed.headerRow === "number" && parsed.headerRow >= 1 ? Math.floor(parsed.headerRow) : null,
    questionCol: toIdx(parsed.questionCol),
    evidenceCol: toIdx(parsed.evidenceCol),
    responseCol: toIdx(parsed.responseCol),
    commentsCol: toIdx(parsed.commentsCol),
  };
}

// Fallback for questions saved before expected_evidence was stored per row: looks for a
// column that names required evidence (common in bank DD questionnaires, e.g.
// "Documents / Information Needed").
const EVIDENCE_HEADER_PATTERN = /evidence|document.*need|information.*need|required/i;

function findExpectedEvidence(rowData: Record<string, string> | null | undefined): string | null {
  if (!rowData) return null;
  for (const [header, value] of Object.entries(rowData)) {
    if (EVIDENCE_HEADER_PATTERN.test(header) && value.trim()) return value.trim();
  }
  return null;
}

const MAX_RETRIEVED_DOCS = 6;
// A client's own documents win ties against General ones of similar relevance.
const CLIENT_DOC_BOOST = 0.1;

export type Citation = { id: string; filename: string; scope?: "client" | "general" };
export type ComparisonStatus = "same" | "reworded" | "changed" | "new";
export type SourceScope = "client" | "general" | "mixed";

export type GeneratedAnswer = {
  responseValue: string;
  comments: string;
  citations: Citation[];
  confidenceLevel: "high" | "medium" | "low";
  confidenceScore: number;
  // 0-10 readiness score: 0-4 recheck, 5-7 partial/update, 8-10 ready.
  score: number;
  suggestedAction: string | null;
  comparisonStatus: ComparisonStatus;
  comparisonNote: string | null;
  recommendation: string | null;
  sourceScope: SourceScope | null;
  // The question's own embedding (for persisting so *future* similar questions, e.g. next
  // year's questionnaire, can find this one), and which prior question (if any) was used
  // as reference context — both null when there's nothing to store.
  embeddingLiteral: string;
  priorQuestionId: string | null;
};

// Cosine-similarity cut-offs for how a question relates to one asked before. Deliberately
// conservative at the top: a wrong "same" would feed the model an answer to a different
// question. Worth tuning against real year-over-year data.
const SAME_THRESHOLD = 0.95;
const REWORDED_THRESHOLD = 0.88;
const CHANGED_THRESHOLD = 0.78;

export function comparisonFromSimilarity(similarity: number): ComparisonStatus {
  if (similarity >= SAME_THRESHOLD) return "same";
  if (similarity >= REWORDED_THRESHOLD) return "reworded";
  if (similarity >= CHANGED_THRESHOLD) return "changed";
  return "new";
}

export type PriorMatch = {
  id: string;
  question_text: string;
  response_value: string | null;
  answer_text: string | null;
  similarity: number;
};

// Best answered question from the same client's *other* questionnaires. Only ever looks
// inside one client — wording and conventions differ per client, so answers never leak
// between clients, and a General questionnaire has nothing to compare against.
export async function findPriorMatch(
  vectorLiteral: string,
  clientId: string | null,
  excludeDocumentId: string
): Promise<PriorMatch | null> {
  if (!clientId) return null;
  const rows = await sql`
    select q.id, q.question_text, q.response_value, q.answer_text,
           1 - (q.embedding <=> ${vectorLiteral}::vector) as similarity
    from questions q
    join documents d on d.id = q.document_id
    where d.client_id = ${clientId}::uuid
      and d.id != ${excludeDocumentId}::uuid
      and q.answer_status = 'ok'
      and q.embedding is not null
    order by q.embedding <=> ${vectorLiteral}::vector
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  const similarity = Number(row.similarity);
  if (similarity < CHANGED_THRESHOLD) return null;
  return {
    id: row.id as string,
    question_text: row.question_text as string,
    response_value: (row.response_value as string | null) ?? null,
    answer_text: (row.answer_text as string | null) ?? null,
    similarity,
  };
}

function clampUnit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function levelFromScore(score: number): "high" | "medium" | "low" {
  if (score >= 8) return "high";
  if (score >= 5) return "medium";
  return "low";
}

function normalizeComparison(value: unknown, fallback: ComparisonStatus): ComparisonStatus {
  return value === "same" || value === "reworded" || value === "changed" ? value : fallback;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const STOPWORDS = new Set(
  (
    "that this with have from they their will would should could about which these those there were been being " +
    "what when where does doing done into than then them also such upon only your yours ours other more most " +
    "some any each every must shall may can the and for are not but all has had its our out per via"
  ).split(" ")
);

function keywordsOf(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))];
}

// A long policy can be tens of thousands of characters, and the part that answers a
// question is rarely at the top. Instead of sending each document's opening, split it
// into passages and send the opening (for context and the document reference) plus the
// passages that share the most meaningful words with the question.
function selectPassages(text: string, keywords: string[], budget: number): string {
  if (text.length <= budget) return text;

  const passages: { start: number; text: string }[] = [];
  let current = "";
  let start = 0;
  let offset = 0;
  for (const line of text.split("\n")) {
    if (current.length + line.length > 1100 && current) {
      passages.push({ start, text: current });
      current = "";
      start = offset;
    }
    current += (current ? "\n" : "") + line;
    offset += line.length + 1;
  }
  if (current) passages.push({ start, text: current });

  const opening = passages[0];
  const scored = passages
    .slice(1)
    .map((p) => {
      const lower = p.text.toLowerCase();
      const score = keywords.reduce((sum, k) => (lower.includes(k) ? sum + 1 : sum), 0);
      return { ...p, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);

  let used = Math.min(opening.text.length, 700);
  const chosen = [{ start: opening.start, text: opening.text.slice(0, 700) }];
  for (const p of scored) {
    if (used + p.text.length > budget) continue;
    chosen.push(p);
    used += p.text.length;
  }
  return chosen
    .sort((a, b) => a.start - b.start)
    .map((p) => p.text)
    .join("\n[...]\n");
}

const PASSAGE_BUDGET_PER_DOC = 3600;

export type AnswerContext = {
  questionText: string;
  rowData?: Record<string, string> | null;
  expectedEvidence?: string | null;
  documentId: string;
  clientId: string | null;
};

export async function generateAnswer(ctx: AnswerContext): Promise<GeneratedAnswer> {
  const { questionText, rowData, clientId, documentId } = ctx;
  const vectorLiteral = toVectorLiteral(await generateEmbedding(questionText));

  // Hybrid retrieval: blend keyword relevance (ts_rank) with semantic similarity, the
  // same weighting used for the search bar (src/app/api/search/route.ts), so a document
  // that's an exact terminology match but a weaker semantic match still surfaces.
  // Searches the client's own documents plus the shared General pool (client_id null).
  const rows = await sql`
    select id, filename, extracted_text, client_id,
           (
             coalesce(ts_rank(
               to_tsvector('english', coalesce(filename, '') || ' ' || coalesce(extracted_text, '')),
               plainto_tsquery('english', ${questionText})
             ), 0) * 0.4
             + coalesce(1 - (embedding <=> ${vectorLiteral}::vector), 0) * 0.6
             + case when client_id is not null then ${CLIENT_DOC_BOOST}::float else 0 end
           ) as score
    from documents
    where category in ('policy', 'evidence')
      and embedding is not null
      and extracted_text is not null
      and (client_id is null or client_id = ${clientId}::uuid)
    order by score desc
    limit ${MAX_RETRIEVED_DOCS}
  `;

  const priorMatch = await findPriorMatch(vectorLiteral, clientId, documentId);
  const similarityStatus: ComparisonStatus = priorMatch ? comparisonFromSimilarity(priorMatch.similarity) : "new";

  if (rows.length === 0) {
    return {
      responseValue: "No",
      comments: "No supporting policy found – requires manual review.",
      citations: [],
      confidenceLevel: "low",
      confidenceScore: 0,
      score: 0,
      suggestedAction: "Upload a policy or evidence document covering this control area.",
      comparisonStatus: similarityStatus,
      comparisonNote: null,
      recommendation: priorMatch
        ? "No current policy or evidence supports this. Last year's answer is shown for reference only — verify it before reusing."
        : null,
      sourceScope: null,
      embeddingLiteral: vectorLiteral,
      priorQuestionId: priorMatch ? priorMatch.id : null,
    };
  }

  const expectedEvidence = ctx.expectedEvidence ?? findExpectedEvidence(rowData);
  const keywords = keywordsOf(`${questionText} ${expectedEvidence ?? ""}`);
  const excerpts = rows
    .map(
      (r) =>
        `[doc id="${r.id}" filename="${r.filename}" scope="${r.client_id ? "client" : "general"}"]\n${selectPassages(String(r.extracted_text), keywords, PASSAGE_BUDGET_PER_DOC)}\n[/doc]`
    )
    .join("\n\n");
  const userContent = [
    `Excerpts:\n\n${excerpts}`,
    expectedEvidence ? `Evidence the client expects for this question: ${expectedEvidence}` : null,
    priorMatch
      ? `The same client's previous questionnaire had a ${similarityStatus === "same" ? "near-identical" : "related"} ` +
        `question, answered as follows (reference only — reuse or adapt it ONLY if the excerpts above still ` +
        `support it; if they contradict it or no longer support it, answer fresh from the excerpts):\n` +
        `Previous question: ${priorMatch.question_text}\n` +
        `Previous response: ${priorMatch.response_value}\n` +
        `Previous comments: ${priorMatch.answer_text}`
      : null,
    `Question: ${questionText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const parsed = await generateJsonDeepSeek<{
    response?: unknown;
    comments?: unknown;
    confidenceScore?: unknown;
    suggestedAction?: unknown;
    supportingDocumentIds?: unknown;
    comparisonStatus?: unknown;
    comparisonNote?: unknown;
    recommendation?: unknown;
  }>(
    "You are an IT/security audit compliance assistant answering a due-diligence questionnaire " +
      "question for a banking client, using ONLY the provided policy/evidence excerpts. Never invent " +
      "facts not present in the excerpts, and never include passwords, API keys, or other secrets in " +
      "your answer even if they appear in the excerpts.\n\n" +
      "Determine:\n" +
      '- response: "Yes" if the excerpts clearly and fully support a positive answer. "Partial" if the ' +
      "excerpts address ANY part of the question — a related process, a policy that covers some of the " +
      "listed points, or a control that exists but lacks something asked for. Prefer Partial over No " +
      'whenever related content exists. "No" ONLY if the excerpts contain nothing relevant, or clearly ' +
      'contradict the requirement. "NA" if the question does not apply, or a short free-text value if the ' +
      "question is not a yes/no/na question (e.g. asks for a description, a number, or a list).\n" +
      "- comments: a concise (max 200 words), formal justification suitable for submission to a bank. " +
      "State the control/process in place, cite the specific document (and section/clause if " +
      "identifiable from the excerpt), and mention frequency, scope, or metrics where relevant. If the " +
      "question lists sub-points (a, b, c ...), say which are covered and by which document, and which are " +
      "not covered. If partial, state clearly what is missing. Put this wording in comments, never in the " +
      'response field. Only if the excerpts contain nothing relevant at all, use exactly: "No supporting ' +
      'policy found – requires manual review."\n' +
      "- confidenceScore (0 to 1): how well the excerpts support the answer. 0.8+ only if at least two " +
      "strong, unambiguous matches fully cover the question and any evidence the client expects; " +
      "0.5-0.79 if one strong but incomplete match or the answer is only partly covered; below 0.5 if " +
      "the evidence is weak, indirect, or absent.\n" +
      '- suggestedAction: only when response is "No" or "Partial", or confidenceScore is below 0.8 — a short, ' +
      'concrete next step (e.g. "Draft a policy covering X", "Update the Y policy to address Z"). ' +
      "Otherwise null.\n" +
      (priorMatch
        ? '- comparisonStatus: how the current question relates to the previous one — "same" (same ask, ' +
          'same meaning), "reworded" (same meaning, different wording), or "changed" (part of the ask is ' +
          "different).\n" +
          "- comparisonNote: if reworded/changed, in one or two sentences say exactly what differs between the " +
          "two questions; otherwise null.\n" +
          "- recommendation: tell the IT team in one to three sentences whether last year's answer can be " +
          "reused as-is, or what to update in the response, remark or evidence given the current excerpts, " +
          "and anything better that can now be said than last year.\n"
        : '- recommendation: required whenever the response is "Partial" or "No" — one to three sentences ' +
          "naming the policy section to add or amend, or the evidence to prepare, so the question can be " +
          "answered in full; otherwise null.\n") +
      '\nRespond with JSON: {"response": string, "comments": string, "confidenceScore": number, ' +
      '"suggestedAction": string|null, "supportingDocumentIds": string[], ' +
      '"comparisonStatus": string|null, "comparisonNote": string|null, "recommendation": string|null}. ' +
      "supportingDocumentIds must be a subset of the doc ids shown in the excerpts, limited to the ones " +
      "that actually support the answer.",
    userContent
  );

  let responseValue = typeof parsed.response === "string" ? parsed.response.trim() : "";
  // The model occasionally puts the "no evidence" sentence in the response field; that
  // sentence belongs in the comments, and the response is simply "No".
  if (/^no supporting policy/i.test(responseValue)) responseValue = "No";
  const comments = typeof parsed.comments === "string" ? parsed.comments.trim() : "";
  if (!responseValue || !comments) {
    throw new Error("Model response did not include a response and comments");
  }

  const supportingIds = new Set(
    Array.isArray(parsed.supportingDocumentIds) ? parsed.supportingDocumentIds : []
  );
  const citations: Citation[] = rows
    .filter((r) => supportingIds.has(r.id as string))
    .map((r) => ({
      id: r.id as string,
      filename: r.filename as string,
      scope: r.client_id ? ("client" as const) : ("general" as const),
    }));
  const hasClient = citations.some((c) => c.scope === "client");
  const hasGeneral = citations.some((c) => c.scope === "general");
  const sourceScope: SourceScope | null =
    hasClient && hasGeneral ? "mixed" : hasClient ? "client" : hasGeneral ? "general" : null;

  const comparisonStatus = priorMatch
    ? normalizeComparison(parsed.comparisonStatus, similarityStatus)
    : "new";

  let score = Math.round(clampUnit(parsed.confidenceScore) * 100) / 10;
  let recommendation = optionalText(parsed.recommendation);
  // If a near-identical question was answered differently last time, the two answers
  // disagree and a human should look before either goes out — never rate that "ready".
  if (
    priorMatch &&
    (comparisonStatus === "same" || comparisonStatus === "reworded") &&
    priorMatch.response_value &&
    priorMatch.response_value.trim().toLowerCase() !== responseValue.toLowerCase() &&
    score > 7
  ) {
    score = 7;
    recommendation =
      `Last year's response was "${priorMatch.response_value}" but the current evidence supports "${responseValue}". ` +
      (recommendation ?? "");
  }

  return {
    responseValue,
    comments,
    citations,
    confidenceLevel: levelFromScore(score),
    confidenceScore: clampUnit(parsed.confidenceScore),
    score,
    suggestedAction: optionalText(parsed.suggestedAction),
    comparisonStatus,
    comparisonNote: optionalText(parsed.comparisonNote),
    recommendation,
    sourceScope,
    embeddingLiteral: vectorLiteral,
    priorQuestionId: priorMatch ? priorMatch.id : null,
  };
}
