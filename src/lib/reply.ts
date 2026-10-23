import { generate, type Usage } from "./ai";

// What a client wrote back about our answer, and how it relates to what we said.
//   agreed    the client accepts our answer
//   different the client states something else, or says ours is wrong
//   query     the client asks a question or wants more (evidence, detail)
//   unclear   cannot tell; IT should read it
export type ReplyStatus = "agreed" | "different" | "query" | "unclear";

export function asReplyStatus(v: unknown): ReplyStatus | null {
  return v === "agreed" || v === "different" || v === "query" || v === "unclear" ? v : null;
}

export const REPLY_STATUS_LABEL: Record<ReplyStatus, string> = {
  agreed: "Agreed",
  different: "Different",
  query: "Client query",
  unclear: "Unclear",
};

// Reads the client's reply next to our answer and says which of the four it is, with a one-line
// note for IT. Never throws: when the AI is unavailable the caller falls back to "unclear".
export async function classifyReply(input: {
  question: string;
  ourResponse: string;
  ourRemark: string;
  reply: string;
}): Promise<{ status: ReplyStatus; note: string | null; usage: Usage | null }> {
  try {
    const r = await generate({
      system:
        "A bank client reviewed an answer our company gave to a due-diligence question and wrote a reply. " +
        "Classify the reply as exactly one of: " +
        '"agreed" (accepts the answer, no issue, acknowledged), ' +
        '"different" (states a different answer, disagrees, or says ours is wrong or not acceptable), ' +
        '"query" (asks a question, or asks for more detail, evidence or a document), ' +
        '"unclear" (you cannot tell). ' +
        "Also write a note: one short plain sentence (at most 25 words) telling the IT team what the client said or needs. " +
        'Use null for the note when the status is "agreed". ' +
        'Respond with JSON: {"status": string, "note": string|null}.',
      user:
        `Question: ${input.question.slice(0, 600)}\n` +
        `Our answer: ${input.ourResponse}${input.ourRemark ? ` - ${input.ourRemark.slice(0, 500)}` : ""}\n` +
        `Client reply: ${input.reply.slice(0, 1500)}`,
      json: true,
      maxTokens: 300,
    });
    const parsed = JSON.parse(r.text) as { status?: unknown; note?: unknown };
    const status = asReplyStatus(typeof parsed.status === "string" ? parsed.status.trim().toLowerCase() : null) ?? "unclear";
    const note = typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim() : null;
    return { status, note: status === "agreed" ? null : note, usage: r.usage };
  } catch (err) {
    console.error("Reply classification failed:", err);
    return { status: "unclear", note: null, usage: null };
  }
}
