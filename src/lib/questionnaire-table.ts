import ExcelJS from "exceljs";
import { parse as parseHtml } from "node-html-parser";
import mammoth from "mammoth";

export type ParsedTable = { headers: string[]; rows: string[][] };

// Which columns hold what, as 0-based indexes into the table. Anything left out falls
// back to auto-detection (question column) or is simply unused (the others).
export type ColumnConfig = {
  sheet?: string | null;
  headerRow?: number | null; // 1-based, counting non-empty rows
  questionCol?: number | null;
  evidenceCol?: number | null;
  responseCol?: number | null;
  commentsCol?: number | null;
};

export type Grid = { sheets: string[]; sheet: string | null; rows: string[][] };

function padRows(rawRows: string[][]): string[][] {
  const maxCols = Math.max(...rawRows.map((r) => r.length));
  return rawRows.map((r) => {
    const copy = [...r];
    while (copy.length < maxCols) copy.push("");
    return copy;
  });
}

// Reads the raw cell grid from an .xlsx sheet (named, or the first) or the first table of
// a .docx. Returns null when there is nothing table-shaped to read.
export async function readGrid(
  buffer: Buffer,
  mimeType: string,
  sheetName?: string | null
): Promise<Grid | null> {
  if (mimeType.includes("spreadsheetml")) {
    const workbook = new ExcelJS.Workbook();
    // exceljs's own .d.ts declares a minimal global `Buffer` that conflicts with Node's
    // real Buffer type project-wide (see src/lib/extract.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
    await workbook.xlsx.load(buffer as any);
    const sheets = workbook.worksheets.map((w) => w.name);
    const worksheet =
      (sheetName ? workbook.worksheets.find((w) => w.name === sheetName) : null) ??
      workbook.worksheets[0];
    if (!worksheet) return null;

    const rows: string[][] = [];
    worksheet.eachRow((row) => {
      const cells: string[] = [];
      for (let i = 1; i <= row.cellCount; i++) cells.push((row.getCell(i).text ?? "").trim());
      rows.push(cells);
    });
    return rows.length > 0 ? { sheets, sheet: worksheet.name, rows } : null;
  }

  const { value: html } = await mammoth.convertToHtml({ buffer });
  const table = parseHtml(html).querySelector("table");
  if (!table) return null;
  const rows = table
    .querySelectorAll("tr")
    .map((tr) => tr.querySelectorAll("td, th").map((cell) => cell.text.trim()));
  return rows.length > 0 ? { sheets: [], sheet: null, rows } : null;
}

export function buildTable(rawRows: string[][], headerRow?: number | null): ParsedTable | null {
  const start = Math.max(0, (headerRow ?? 1) - 1);
  const usable = rawRows.slice(start);
  if (usable.length < 2) return null; // need a header row + at least one data row
  const [headerCells, ...dataRows] = padRows(usable);
  const headers = headerCells.map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows: dataRows };
}

// A row's question text is unreliable to guess from column position alone (layouts vary
// wildly between banks), so this picks the column that's most likely to hold the actual
// question: an explicit header match first, falling back to whichever column reads as the
// most substantial free text (response/evidence columns in an unanswered template are
// typically blank or short, while the question/statement column is the longest).
const QUESTION_HEADER_PATTERN = /question|statement|control|requirement|\bitem\b|description/i;

function pickQuestionColumnIndex(headers: string[], rows: string[][]): number {
  const keywordIdx = headers.findIndex((h) => QUESTION_HEADER_PATTERN.test(h));
  if (keywordIdx !== -1) return keywordIdx;

  let bestIdx = 0;
  let bestAvgLength = -1;
  for (let col = 0; col < headers.length; col++) {
    const total = rows.reduce((sum, r) => sum + (r[col]?.length ?? 0), 0);
    const avg = total / (rows.length || 1);
    if (avg > bestAvgLength) {
      bestAvgLength = avg;
      bestIdx = col;
    }
  }
  return bestIdx;
}

// A column where most non-empty values are short integers is almost always a row
// number / control-ID column. Real questionnaire rows are numbered; section headers,
// instructions, and spacer rows spanning the table typically leave it blank — a much
// more reliable "is this a real question row" signal than the question text's length.
function findIndexColumn(headers: string[], rows: string[][]): number | null {
  let bestIdx: number | null = null;
  let bestRatio = 0;
  for (let col = 0; col < headers.length; col++) {
    const nonEmpty = rows.map((r) => (r[col] ?? "").trim()).filter((v) => v !== "");
    if (nonEmpty.length === 0) continue;
    const numericCount = nonEmpty.filter((v) => /^\d+(\.\d+)*$/.test(v)).length;
    const ratio = numericCount / nonEmpty.length;
    if (ratio > 0.6 && ratio > bestRatio) {
      bestRatio = ratio;
      bestIdx = col;
    }
  }
  return bestIdx;
}

// Rows shorter than this in the question column are treated as section headers, spacer
// rows, or otherwise not a real question, and are skipped.
const MIN_QUESTION_LENGTH = 10;

// Common bank-questionnaire wording for the column that names the proof they expect.
const EVIDENCE_HEADER_PATTERN = /evidence|document.*need|information.*need|required/i;

export type QuestionRow = {
  questionText: string;
  rowData: Record<string, string>;
  expectedEvidence: string | null;
};

export function resolveQuestionColumn(table: ParsedTable, config?: ColumnConfig | null): number {
  const configured = config?.questionCol;
  if (configured != null && configured >= 0 && configured < table.headers.length) return configured;
  return pickQuestionColumnIndex(table.headers, table.rows);
}

export function toQuestionRows(table: ParsedTable, config?: ColumnConfig | null): QuestionRow[] {
  const questionColIdx = resolveQuestionColumn(table, config);
  // Rows without a number are section headings/notes, even when the question column was
  // picked by hand — as long as a numbering column exists and isn't the question column.
  const detectedIndexCol = findIndexColumn(table.headers, table.rows);
  const indexColIdx = detectedIndexCol === questionColIdx ? null : detectedIndexCol;

  const evidenceIdx =
    config?.evidenceCol != null && config.evidenceCol < table.headers.length
      ? config.evidenceCol
      : table.headers.findIndex((h) => EVIDENCE_HEADER_PATTERN.test(h));

  const result: QuestionRow[] = [];
  for (const row of table.rows) {
    const questionText = (row[questionColIdx] ?? "").trim();
    if (questionText.length < MIN_QUESTION_LENGTH) continue;
    if (indexColIdx !== null && (row[indexColIdx] ?? "").trim() === "") continue;

    const rowData: Record<string, string> = {};
    table.headers.forEach((header, i) => {
      rowData[header] = row[i] ?? "";
    });
    const evidence = evidenceIdx >= 0 ? (row[evidenceIdx] ?? "").trim() : "";
    result.push({ questionText, rowData, expectedEvidence: evidence || null });
  }

  return result;
}
