import ExcelJS from "exceljs";
import type { Citation } from "./questions";

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
  suggested_action: string | null;
  answer_status: string;
};

const GENERATED_HEADERS = [
  "Response",
  "Comments",
  "Evidence / Citations",
  "Confidence",
  "Suggested Action",
  "Status",
];

// Rebuilds the questionnaire as an .xlsx: if it was parsed from a structured table
// (column_headers present), reproduces the client's original columns with generated
// answer columns appended; otherwise falls back to a plain Question/Answer sheet for
// questionnaires that were only parsed as free text (e.g. PDFs).
export async function buildQuestionnaireExport(
  columnHeaders: string[] | null,
  questions: QuestionExportRow[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Answers");

  const headers = columnHeaders && columnHeaders.length > 0 ? columnHeaders : ["#", "Question"];
  worksheet.addRow([...headers, ...GENERATED_HEADERS]);

  for (const q of questions) {
    const citationText = q.citations.map((c) => c.filename).join("; ");
    const leadingValues =
      columnHeaders && columnHeaders.length > 0
        ? columnHeaders.map((h) => q.row_data?.[h] ?? "")
        : [q.position + 1, q.question_text];
    const score = q.confidence_score != null ? Number(q.confidence_score) : null;
    const confidenceText = q.confidence_level
      ? `${q.confidence_level}${score != null && !Number.isNaN(score) ? ` (${score.toFixed(2)})` : ""}`
      : "";

    worksheet.addRow([
      ...leadingValues,
      q.response_value ?? "",
      q.answer_text ?? "",
      citationText,
      confidenceText,
      q.suggested_action ?? "",
      q.answer_status,
    ]);
  }

  // Re-wrap through Buffer.from rather than casting: exceljs's own .d.ts declares a
  // minimal global `Buffer` that conflicts with Node's real Buffer type project-wide,
  // so this also guarantees callers get a genuine Buffer instance, not just a type
  // assertion papering over the mismatch.
  const raw = await workbook.xlsx.writeBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  return Buffer.from(raw as any);
}
