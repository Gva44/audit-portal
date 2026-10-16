import { sql } from "./db";
import { generate, type Usage } from "./ai";
import { fetchQuestions } from "./question-queries";
import { retrieveDocs } from "./questions";

export type AssistantAction =
  | "explain"
  | "raise_score"
  | "draft_policy"
  | "rewrite_answer"
  | "improve_policy"
  | "gap_report"
  | "evidence_checklist"
  | "fix_first";

export const QUESTION_ACTIONS: AssistantAction[] = ["explain", "raise_score", "draft_policy", "rewrite_answer", "improve_policy"];
export const DOCUMENT_ACTIONS: AssistantAction[] = ["gap_report", "evidence_checklist", "fix_first"];

export type AssistantResult = {
  title: string;
  text: string;
  modelUsed: string;
  usage: Usage;
  // Drafts and rewrites are offered as a Word download.
  downloadable: boolean;
  // Present for a rewritten answer: wording the person can choose to put into the answer.
  proposed?: { responseValue: string; answerText: string };
};

const SYSTEM = [
  "You are an IT governance advisor helping the IT team of Newvest Recoveries Sdn Bhd answer bank due-diligence questionnaires and keep their IT policies and evidence strong.",
  "Rules:",
  "- Facts about the company must come only from the material provided. Never invent dates, names, tools, versions or approvals. Where a specific is needed and not provided, write a placeholder such as [OWNER NAME] or [DATE].",
  "- Be clear about what the provided documents evidence and what you are suggesting.",
  "- Write for busy IT staff: short, concrete, practical. Plain text only: headings on their own line starting with '## ', bullets starting with '- ', numbered steps as '1. '. No tables, no bold markers, no code fences.",
].join("\n");

function trimText(text: string | null | undefined, max: number): string {
  return (text ?? "").slice(0, max);
}

function scoreOf(v: unknown): string {
  const n = Number(v);
  return v == null || Number.isNaN(n) ? "n/a" : n.toFixed(1);
}

type QuestionRow = Awaited<ReturnType<typeof fetchQuestions>>[number];

function describeQuestion(q: QuestionRow): string {
  return [
    `Question ${Number(q.position) + 1}: ${q.question_text}`,
    q.expected_evidence ? `Evidence the client expects: ${q.expected_evidence}` : null,
    `Current response: ${q.response_value ?? "not answered yet"} (readiness score ${scoreOf(q.score)} out of 10; 0-4 recheck, 5-7 needs updating, 8-10 ready)`,
    q.answer_text ? `Current answer text: ${q.answer_text}` : null,
    q.recommendation ? `Earlier recommendation: ${q.recommendation}` : null,
    q.suggested_action ? `Earlier suggested action: ${q.suggested_action}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function loadQuestion(questionId: string) {
  const rows = await fetchQuestions({ questionId });
  const q = rows[0];
  if (!q) throw new Error("Question not found");
  const docRows = await sql`
    select d.client_id, c.name as client_name from documents d left join clients c on c.id = d.client_id where d.id = ${q.document_id as string}
  `;
  return {
    q,
    clientId: (docRows[0]?.client_id as string | null) ?? null,
    clientName: (docRows[0]?.client_name as string | null) ?? null,
  };
}

function formatDocs(docs: { filename: string; clientId: string | null; text: string }[]): string {
  if (docs.length === 0) return "(no matching policy or evidence documents were found)";
  return docs
    .map((d) => `--- ${d.filename} (${d.clientId ? "client document" : "General document"}) ---\n${d.text}`)
    .join("\n\n");
}

export async function runAssistant(params: {
  action: AssistantAction;
  questionId?: string;
  documentId?: string;
  policyId?: string;
  ask?: string;
}): Promise<AssistantResult> {
  const { action } = params;
  const ask = params.ask?.trim().slice(0, 600);

  // ---------- per-question actions ----------
  if (QUESTION_ACTIONS.includes(action)) {
    if (!params.questionId) throw new Error("questionId is required");
    const { q, clientId, clientName } = await loadQuestion(params.questionId);
    const scope = clientName ? `Client: ${clientName}` : "Client: General (no specific client)";
    const base = `${scope}\n\n${describeQuestion(q)}`;

    if (action === "explain") {
      const docs = await retrieveDocs(`${q.question_text} ${q.expected_evidence ?? ""}`, clientId, 5);
      const r = await generate({
        system: SYSTEM,
        user:
          `${base}\n\nPolicy and evidence excerpts available:\n${formatDocs(docs)}\n\n` +
          (ask
            ? `The user asks: ${ask}\nAnswer it using the material above, naming the document each point comes from, and say so if it is not in the documents.`
            : "Explain in plain language why this question received this response and score: what in the documents supports it (name each document), what is missing, and what that means for how confident the team can be before sending it to the client. Keep it under 250 words."),
        maxTokens: 1200,
      });
      return { title: ask ? "Your question" : "Why this answer", text: r.text, modelUsed: r.modelUsed, usage: r.usage, downloadable: false };
    }

    if (action === "raise_score") {
      const docs = await retrieveDocs(`${q.question_text} ${q.expected_evidence ?? ""}`, clientId, 5);
      const r = await generate({
        system: SYSTEM,
        user:
          `${base}\n\nPolicy and evidence excerpts available:\n${formatDocs(docs)}\n\n` +
          "Give the steps that would move this question to a readiness score of 8 or above. Format: a one-line verdict on the current position, then '## Steps' as a numbered list ordered by impact. Each step names the exact document to create or amend (and the section), or the evidence to collect (what it should show, who usually owns it). End with '## Quick win' naming the single easiest step. Keep it under 300 words.",
        maxTokens: 1500,
      });
      return { title: "How to raise this score", text: r.text, modelUsed: r.modelUsed, usage: r.usage, downloadable: false };
    }

    if (action === "draft_policy") {
      const docs = await retrieveDocs(`${q.question_text} ${q.expected_evidence ?? ""}`, clientId, 3);
      const r = await generate({
        system: SYSTEM,
        user:
          `${base}\n\nExisting related documents (use them for the company's tone, structure and references; do not copy unrelated content):\n${formatDocs(docs)}\n\n` +
          (ask ? `Extra instruction from the user: ${ask}\n\n` : "") +
          "Draft the policy or procedure that would properly answer this question and satisfy the evidence expected. Structure: title line starting '## ', then these sections each as a '## ' heading: Document control (owner, version, effective date, review date, approver — all as placeholders), Purpose, Scope, Roles and responsibilities, Policy statements (numbered, specific and auditable), Procedure or process steps, Records and evidence kept, Review and exceptions. Use placeholders for anything not known. The very first line must be exactly: AI DRAFT - requires review and approval before use. Aim for 500-800 words.",
        maxTokens: 3500,
      });
      return { title: "Draft policy", text: r.text, modelUsed: r.modelUsed, usage: r.usage, downloadable: true };
    }

    if (action === "rewrite_answer") {
      const docs = await retrieveDocs(`${q.question_text} ${q.expected_evidence ?? ""}`, clientId, 5);
      const r = await generate({
        system:
          SYSTEM +
          '\nRespond with JSON: {"response": string, "comments": string}.',
        user:
          `${base}\n\nPolicy and evidence excerpts available:\n${formatDocs(docs)}\n\n` +
          (ask ? `Extra instruction from the user: ${ask}\n\n` : "") +
          'Rewrite this answer so it is ready to send to the bank client. "response" is one of Yes, Partial, No, NA, or a short value if the question is not yes/no. Be honest: do NOT upgrade the response beyond what the excerpts support — if the evidence is partial, the response stays Partial and the comments say plainly what is covered and what is not. "comments" is formal and concise (max 180 words): state the control in place, name the specific document(s) and clause where identifiable, and mention frequency or scope where relevant. Do not include advice to the IT team in the comments; this text goes to the client. Never include passwords, keys or other secrets.',
        json: true,
        maxTokens: 1500,
      });
      let parsed: { response?: unknown; comments?: unknown } = {};
      try {
        parsed = JSON.parse(r.text);
      } catch {
        throw new Error("The assistant returned something that could not be read. Please try again.");
      }
      const responseValue = typeof parsed.response === "string" ? parsed.response.trim() : "";
      const answerText = typeof parsed.comments === "string" ? parsed.comments.trim() : "";
      if (!responseValue || !answerText) throw new Error("The assistant did not return a complete answer. Please try again.");
      return {
        title: "Rewritten answer",
        text: `## Response\n${responseValue}\n\n## Comments\n${answerText}`,
        modelUsed: r.modelUsed,
        usage: r.usage,
        downloadable: false,
        proposed: { responseValue, answerText },
      };
    }

    // improve_policy
    if (!params.policyId) throw new Error("Choose which policy to improve");
    const docRows = await sql`select filename, extracted_text from documents where id = ${params.policyId} and category in ('policy', 'evidence')`;
    const doc = docRows[0];
    if (!doc) throw new Error("Policy not found");
    const r = await generate({
      system: SYSTEM,
      user:
        `${base}\n\nThe policy to improve is "${doc.filename}". Its current text:\n${trimText(doc.extracted_text as string, 16000)}\n\n` +
        (ask ? `Extra instruction from the user: ${ask}\n\n` : "") +
        "First list under '## What to change' the specific gaps between this policy and what the question expects (reference the section being amended). Then under '## Suggested wording' give the exact new or replacement clauses to add, ready to paste into the policy, using placeholders where a specific is unknown. The very first line must be exactly: AI DRAFT - requires review and approval before use. Keep it under 600 words.",
      maxTokens: 3000,
    });
    return { title: `Improve: ${doc.filename}`, text: r.text, modelUsed: r.modelUsed, usage: r.usage, downloadable: true };
  }

  // ---------- whole-questionnaire actions ----------
  if (!params.documentId) throw new Error("documentId is required");
  const docInfo = await sql`
    select d.filename, d.client_id, c.name as client_name from documents d left join clients c on c.id = d.client_id
    where d.id = ${params.documentId} and d.category = 'questionnaire'
  `;
  const info = docInfo[0];
  if (!info) throw new Error("Questionnaire not found");
  const clientId = (info.client_id as string | null) ?? null;
  const questions = await fetchQuestions({ documentId: params.documentId });
  const answered = questions.filter((q) => q.answer_status === "ok");
  if (answered.length === 0) throw new Error("Generate some answers first, so there is something to analyse.");

  const library = await sql`
    select filename, category, client_id from documents
    where category in ('policy', 'evidence') and (client_id is null or client_id = ${clientId}::uuid)
    order by category, filename
  `;
  const libraryText = library
    .map((d) => `- ${d.filename} (${d.category}, ${d.client_id ? "client" : "General"})`)
    .join("\n");
  const header = `Questionnaire: ${info.filename}\n${info.client_name ? `Client: ${info.client_name}` : "Client: General"}\nQuestions answered: ${answered.length} of ${questions.length}\n\nDocuments currently in the library:\n${libraryText || "(none)"}`;

  const compact = (list: QuestionRow[]) =>
    list
      .map((q) => {
        const parts = [
          `Q${Number(q.position) + 1} [${q.response_value ?? "-"}, ${scoreOf(q.score)}]`,
          trimText(q.question_text, 220).replace(/\s+/g, " "),
          q.expected_evidence ? `evidence expected: ${trimText(q.expected_evidence, 160).replace(/\s+/g, " ")}` : null,
          q.recommendation ? `recommendation: ${trimText(q.recommendation, 260)}` : null,
        ];
        return parts.filter(Boolean).join(" | ");
      })
      .join("\n");

  const weak = answered.filter((q) => Number(q.score) < 8);

  if (action === "gap_report") {
    const r = await generate({
      system: SYSTEM,
      user:
        `${header}\n\nAnswers scoring below 8 (question, [response, score], what was recommended):\n${compact(weak)}\n\n` +
        "Produce a policy roadmap. Group the weak answers into the documents the team should create or amend. Format: '## Summary' (3 sentences: overall position and the single biggest theme), then '## Documents to create' and '## Documents to amend' — for each item: a heading line with the document name, then bullets: why it is needed, which question numbers it would fix (e.g. Q4, Q12), and what it must cover. Order items by how many questions each fixes, most first. Finish with '## Suggested order of work'. Keep it under 600 words.",
      maxTokens: 2500,
    });
    return { title: "Gap report", text: r.text, modelUsed: r.modelUsed, usage: r.usage, downloadable: true };
  }

  if (action === "evidence_checklist") {
    const withEvidence = questions.filter((q) => q.expected_evidence);
    if (withEvidence.length === 0) throw new Error("None of these questions list the evidence the client expects, so there is nothing to build a checklist from. Check Column setup.");
    const r = await generate({
      system: SYSTEM,
      user:
        `${header}\n\nQuestions with the evidence the client expects:\n${compact(withEvidence)}\n\n` +
        "Turn this into an evidence checklist the IT team can work through. Group similar evidence together (for example all test reports, all certificates, all training records). For each group: '## <group name>', then a bullet per item: the evidence needed, the question numbers it supports, and whether something suitable already appears in the library (name the document) or is still to collect. End with '## Still to collect' listing only the missing items. Keep it under 600 words.",
      maxTokens: 2500,
    });
    return { title: "Evidence checklist", text: r.text, modelUsed: r.modelUsed, usage: r.usage, downloadable: true };
  }

  // fix_first
  const lowest = [...weak].sort((a, b) => Number(a.score) - Number(b.score)).slice(0, 25);
  const r = await generate({
    system: SYSTEM,
    user:
      `${header}\n\nWeakest answers (lowest scores first):\n${compact(lowest)}\n\n` +
      "List what to fix first. Pick the 8 to 10 items that will lift the most answers for the least effort. Format: numbered list; each item: the question number(s), what is wrong in one line, the exact fix, and effort as Low, Medium or High. End with one sentence on the expected effect on readiness. Keep it under 400 words.",
    maxTokens: 2000,
  });
  return { title: "Fix these first", text: r.text, modelUsed: r.modelUsed, usage: r.usage, downloadable: false };
}
