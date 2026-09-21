import ExcelJS from "exceljs";
import type { Citation } from "./questions";

export type QuestionExportRow = {
  position: number;
  question_text: string;
  row_data: Record<string, string> | null;
  answer_text: string | null;
  citations: Citation[];
  answer_status: string;
};

const GENERATED_HEADERS = ["AI Answer", "Evidence / Citations", "Status"];

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

    worksheet.addRow([...leadingValues, q.answer_text ?? "", citationText, q.answer_status]);
  }

  // Re-wrap through Buffer.from rather than casting: exceljs's own .d.ts declares a
  // minimal global `Buffer` that conflicts with Node's real Buffer type project-wide,
  // so this also guarantees callers get a genuine Buffer instance, not just a type
  // assertion papering over the mismatch.
  const raw = await workbook.xlsx.writeBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  return Buffer.from(raw as any);
}
