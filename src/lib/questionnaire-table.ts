import ExcelJS from "exceljs";
import { parse as parseHtml } from "node-html-parser";
import mammoth from "mammoth";

export type ParsedTable = { headers: string[]; rows: string[][] };

function padRows(rawRows: string[][]): string[][] {
  const maxCols = Math.max(...rawRows.map((r) => r.length));
  return rawRows.map((r) => {
    const copy = [...r];
    while (copy.length < maxCols) copy.push("");
    return copy;
  });
}

function toParsedTable(rawRows: string[][]): ParsedTable | null {
  if (rawRows.length < 2) return null; // need a header row + at least one data row
  const [headerRow, ...dataRows] = padRows(rawRows);
  const headers = headerRow.map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows: dataRows };
}

export async function parseXlsxTable(buffer: Buffer): Promise<ParsedTable | null> {
  const workbook = new ExcelJS.Workbook();
  // See the comment in src/lib/extract.ts's extractFromXlsx: exceljs's own .d.ts
  // declares a minimal global `Buffer` that conflicts with Node's real Buffer type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return null;

  const rawRows: string[][] = [];
  worksheet.eachRow((row) => {
    const cells: string[] = [];
    for (let i = 1; i <= row.cellCount; i++) {
      cells.push((row.getCell(i).text ?? "").trim());
    }
    rawRows.push(cells);
  });

  return toParsedTable(rawRows);
}

export async function parseDocxTable(buffer: Buffer): Promise<ParsedTable | null> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const root = parseHtml(html);
  const table = root.querySelector("table");
  if (!table) return null;

  const rawRows = table
    .querySelectorAll("tr")
    .map((tr) => tr.querySelectorAll("td, th").map((cell) => cell.text.trim()));

  return toParsedTable(rawRows);
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

export type QuestionRow = { questionText: string; rowData: Record<string, string> };

export function toQuestionRows(table: ParsedTable): QuestionRow[] {
  const questionColIdx = pickQuestionColumnIndex(table.headers, table.rows);
  const indexColIdx = findIndexColumn(table.headers, table.rows);
  const result: QuestionRow[] = [];

  for (const row of table.rows) {
    const questionText = (row[questionColIdx] ?? "").trim();
    if (questionText.length < MIN_QUESTION_LENGTH) continue;
    if (indexColIdx !== null && (row[indexColIdx] ?? "").trim() === "") continue;

    const rowData: Record<string, string> = {};
    table.headers.forEach((header, i) => {
      rowData[header] = row[i] ?? "";
    });
    result.push({ questionText, rowData });
  }

  return result;
}
