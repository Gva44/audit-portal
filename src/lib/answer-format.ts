// How long an answer is, and what the client's own response column is allowed to hold.
//
// Brief = one or two plain sentences. Short = two or three bullets. In both, the remark states
// what IS in place; gaps and document names stay out of it (gaps go to the internal
// recommendation, document names to the evidence column).

export type AnswerFormat = "brief" | "short";
export const DEFAULT_FORMAT: AnswerFormat = "short";

export function asFormat(v: unknown): AnswerFormat | null {
  return v === "brief" || v === "short" ? v : null;
}

// auto = work it out from the client's column header (for example "In-Placed (Yes/No)").
// yesno = Yes or No only. yesnopartialna = the client allows Partial and NA too.
// none = the client has no response column, so the remark starts with the answer.
export type AllowedAnswers = "auto" | "yesno" | "yesnopartialna" | "none";

export function asAllowed(v: unknown): AllowedAnswers | null {
  return v === "auto" || v === "yesno" || v === "yesnopartialna" || v === "none" ? v : null;
}

const YES_NO_HEADER = /yes\s*[/,]\s*no/i;
const PARTIAL_HEADER = /partial|n\s*\/?\s*a\b/i;

// Looks at the response column's header first, then any header, for a "(Yes/No)" hint.
export function resolveAllowed(
  setting: AllowedAnswers | null | undefined,
  headers: string[] | null,
  responseIdx: number | null
): Exclude<AllowedAnswers, "auto"> {
  if (setting && setting !== "auto") return setting;
  const own = responseIdx != null && headers ? (headers[responseIdx] ?? "") : "";
  if (own) return YES_NO_HEADER.test(own) && !PARTIAL_HEADER.test(own) ? "yesno" : "yesnopartialna";
  const any = (headers ?? []).find((h) => YES_NO_HEADER.test(h));
  return any && !PARTIAL_HEADER.test(any) ? "yesno" : "yesnopartialna";
}

// What goes into the client's response column. The client file never says "No" because a control
// is missing: Partial (related or alternative controls) is written as Yes. "No" internally means
// nothing related was found at all, so the cell stays empty for IT to fill in. NA means the
// question does not apply: "No" in a Yes/No-only column, "NA" where the client allows it.
// Free-text answers (a name, a number) pass through unchanged.
export function clientResponse(internal: string | null, allowed: Exclude<AllowedAnswers, "auto">): string {
  const v = (internal ?? "").trim();
  if (!v) return "";
  const lower = v.toLowerCase();
  if (lower === "no") return "";
  if (allowed === "yesnopartialna") return lower === "partial" ? "Yes" : v;
  if (lower === "yes" || lower === "partial") return "Yes";
  if (lower === "na" || lower === "n/a") return "No";
  return v;
}

// With no response column, the remark has to carry the answer itself.
export function remarkWithAnswer(response: string, remark: string | null): string {
  const text = (remark ?? "").trim();
  if (!response || /^n\/?a\b/i.test(text)) return text;
  if (!text) return response;
  return text.startsWith("- ") || text.startsWith("•") ? `${response}\n${text}` : `${response}. ${text}`;
}

// Best guesses at which of the client's columns take our answer, from their header text.
// Only used to pre-fill the check card; the team confirms or changes them.
export function suggestColumns(headers: string[], questionIdx: number | null): {
  responseCol: number | null;
  commentsCol: number | null;
  citationsCol: number | null;
} {
  const find = (re: RegExp, skip: (number | null)[]) => {
    const i = headers.findIndex((h, idx) => re.test(h) && !skip.includes(idx));
    return i === -1 ? null : i;
  };
  const responseCol = find(/yes\s*[/,]\s*no|in.?place|\bresponse\b|\banswer\b|complian|\bstatus\b/i, [questionIdx]);
  const commentsCol = find(/remark|comment|justif|explan|\bdetails?\b/i, [questionIdx, responseCol]);
  const citationsCol = find(/evidence.*(provided|reference|attach|submitted)|supporting|reference|attachment/i, [
    questionIdx,
    responseCol,
    commentsCol,
  ]);
  return { responseCol, commentsCol, citationsCol };
}
