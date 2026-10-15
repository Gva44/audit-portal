import ExcelJS from "exceljs";
import type { Citation } from "./questions";
import type { ColumnConfig } from "./questionnaire-table";

export type QuestionExportRow = {
  position: number;
  question_text: string;
  row_data: Record<string, string> | null;
  answer_text: string | null;
  citations: Citation[];
  response_value: string | null;
  confidence_level: string | null;
  // Postgres numeric columns come back as strings from the driver (avoids float
  // precision loss), not JS numbers.
  confidence_score: string | number | null;
  score?: string | number | null;
  suggested_action: string | null;
  answer_status: string;
  expected_evidence?: string | null;
  comparison_status?: string | null;
  comparison_note?: string | null;
  recommendation?: string | null;
  source_scope?: string | null;
  prior_response_value?: string | null;
  prior_answer_text?: string | null;
  generated_by_display_name?: string | null;
  edited_by_display_name?: string | null;
};

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  // Re-wrap through Buffer.from rather than casting: exceljs's own .d.ts declares a
  // minimal global `Buffer` that conflicts with Node's real Buffer type project-wide,
  // so this also guarantees callers get a genuine Buffer instance, not just a type
  // assertion papering over the mismatch.
  const raw = await workbook.xlsx.writeBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  return Buffer.from(raw as any);
}

// The file that goes back to the client: their original columns with our response and
// comments filled in (into the columns the uploader pointed at, if any, otherwise
// appended) plus an evidence column. No scores or internal notes — those live in the
// separate IT review report.
export async function buildQuestionnaireExport(
  columnHeaders: string[] | null,
  questions: QuestionExportRow[],
  config?: ColumnConfig | null
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Answers");

  const hasHeaders = !!columnHeaders && columnHeaders.length > 0;
  const headers = hasHeaders ? columnHeaders : ["#", "Question"];
  const inRange = (i: number | null | undefined) => i != null && i >= 0 && i < headers.length;
  const responseIdx = hasHeaders && inRange(config?.responseCol) ? (config!.responseCol as number) : null;
  const commentsIdx =
    hasHeaders && inRange(config?.commentsCol) && config?.commentsCol !== responseIdx
      ? (config!.commentsCol as number)
      : null;

  const appended: string[] = [];
  if (responseIdx === null) appended.push("Response");
  if (commentsIdx === null) appended.push("Comments");
  appended.push("Evidence / Citations");
  worksheet.addRow([...headers, ...appended]);

  for (const q of questions) {
    const citationText = q.citations.map((c) => c.filename).join("; ");
    const cells: string[] = hasHeaders
      ? columnHeaders.map((h) => q.row_data?.[h] ?? "")
      : [String(q.position + 1), q.question_text];
    if (responseIdx !== null && q.response_value) cells[responseIdx] = q.response_value;
    if (commentsIdx !== null && q.answer_text) cells[commentsIdx] = q.answer_text;

    const extra: string[] = [];
    if (responseIdx === null) extra.push(q.response_value ?? "");
    if (commentsIdx === null) extra.push(q.answer_text ?? "");
    extra.push(citationText);
    worksheet.addRow([...cells, ...extra]);
  }

  worksheet.getRow(1).font = { bold: true };
  return toBuffer(workbook);
}

const BAND_FILL = {
  ready: "FFE1F0E7",
  update: "FFFEF6E7",
  recheck: "FFF7E3E1",
} as const;

export function bandOf(score: number | null): "ready" | "update" | "recheck" | null {
  if (score == null || Number.isNaN(score)) return null;
  if (score >= 8) return "ready";
  if (score >= 5) return "update";
  return "recheck";
}

const BAND_LABEL = { ready: "Ready (8-10)", update: "Update (5-7)", recheck: "Recheck (0-4)" } as const;
const STATUS_LABEL: Record<string, string> = {
  same: "Same as before",
  reworded: "Reworded",
  changed: "Partly changed",
  new: "New question",
};
const SCOPE_LABEL: Record<string, string> = {
  client: "Client documents",
  general: "General documents",
  mixed: "Client + General",
};

// The internal review report for the IT team: everything needed to check the answers
// before the client file goes out. Never sent to the client.
export async function buildReviewReport(
  clientName: string | null,
  documentName: string,
  questions: QuestionExportRow[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const summary = workbook.addWorksheet("Summary");
  const answered = questions.filter((q) => q.answer_status === "ok");
  const scored = answered.map((q) => (q.score != null ? Number(q.score) : null));
  const count = (band: "ready" | "update" | "recheck") => scored.filter((s) => bandOf(s) === band).length;
  const cmp = (s: string) => questions.filter((q) => q.comparison_status === s).length;
  summary.addRows([
    ["IT review report"],
    ["Questionnaire", documentName],
    ["Client", clientName ?? "General (no client)"],
    ["Generated", new Date().toISOString().slice(0, 10)],
    [],
    ["Questions", questions.length],
    ["Answered", answered.length],
    ["Not yet answered", questions.length - answered.length],
    [],
    ["Readiness", ""],
    [BAND_LABEL.ready, count("ready")],
    [BAND_LABEL.update, count("update")],
    [BAND_LABEL.recheck, count("recheck")],
    [],
    ["Compared with the client's previous questionnaires", ""],
    [STATUS_LABEL.same, cmp("same")],
    [STATUS_LABEL.reworded, cmp("reworded")],
    [STATUS_LABEL.changed, cmp("changed")],
    [STATUS_LABEL.new, cmp("new")],
  ]);
  summary.getColumn(1).width = 48;
  summary.getColumn(2).width = 40;
  for (const r of [1, 10, 15]) summary.getRow(r).font = { bold: true };

  const sheet = workbook.addWorksheet("Review");
  const columns: [string, number][] = [
    ["#", 5],
    ["Question", 50],
    ["Evidence the client expects", 36],
    ["Response", 12],
    ["Comments / answer", 60],
    ["Score (0-10)", 11],
    ["Readiness", 16],
    ["Compared with last time", 20],
    ["What changed in the question", 36],
    ["Last time's response", 14],
    ["Last time's answer", 50],
    ["Recommendation", 50],
    ["Suggested action", 40],
    ["Evidence found", 40],
    ["Based on", 20],
    ["Generated by", 18],
    ["Edited by hand by", 18],
  ];
  sheet.columns = columns.map(([header, width]) => ({ header, width }));

  for (const q of questions) {
    const score = q.score != null ? Number(q.score) : null;
    const band = q.answer_status === "ok" ? bandOf(score) : null;
    const row = sheet.addRow([
      q.position + 1,
      q.question_text,
      q.expected_evidence ?? "",
      q.response_value ?? "",
      q.answer_text ?? (q.answer_status === "ok" ? "" : "Not yet answered"),
      score != null && !Number.isNaN(score) ? score : "",
      band ? BAND_LABEL[band] : "",
      q.comparison_status ? (STATUS_LABEL[q.comparison_status] ?? q.comparison_status) : "",
      q.comparison_note ?? "",
      q.prior_response_value ?? "",
      q.prior_answer_text ?? "",
      q.recommendation ?? "",
      q.suggested_action ?? "",
      q.citations.map((c) => c.filename).join("; "),
      q.source_scope ? (SCOPE_LABEL[q.source_scope] ?? q.source_scope) : "",
      q.generated_by_display_name ?? "",
      q.edited_by_display_name ?? "",
    ]);
    row.alignment = { vertical: "top", wrapText: true };
    if (band) {
      for (const col of [6, 7]) {
        row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILL[band] } };
      }
    }
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];

  return toBuffer(workbook);
}
