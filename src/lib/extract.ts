import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { getGemini } from "./gemini";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const IMAGE_MIME_PREFIX = "image/";

// Verify this is still current at https://ai.google.dev/gemini-api/docs/models.
// gemini-flash-latest is an alias that tracks Google's current best Flash model.
const GEMINI_MODEL = "gemini-flash-latest";

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

async function extractFromXlsx(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's own .d.ts declares a minimal global `Buffer extends ArrayBuffer` (for
  // browser compatibility), which conflicts with Node's real Buffer type project-wide.
  // A real Buffer satisfies this at runtime regardless; `as any` is a narrow, contained
  // escape hatch for this specific known upstream typing issue.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  await workbook.xlsx.load(buffer as any);
  const lines: string[] = [];
  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow((row) => {
      const cells: string[] = [];
      for (let i = 1; i <= row.cellCount; i++) {
        const text = (row.getCell(i).text ?? "").trim();
        if (text) cells.push(text);
      }
      if (cells.length > 0) lines.push(cells.join(" | "));
    });
  }
  return lines.join("\n").trim();
}

async function extractWithGemini(
  buffer: Buffer,
  mimeType: string,
  instruction: string
): Promise<string> {
  // Gemini has native PDF/image document understanding (OCR, layout, tables) via inline
  // base64 data. Inline requests are capped at ~20MB total; larger files would need the
  // Files API instead (not implemented here — not needed at this app's document sizes).
  const response = await getGemini().models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      { text: instruction },
      { inlineData: { data: buffer.toString("base64"), mimeType } },
    ],
  });
  return (response.text ?? "").trim();
}

async function extractFromPdf(buffer: Buffer): Promise<string> {
  return extractWithGemini(
    buffer,
    "application/pdf",
    "Extract all text content from this document verbatim, preserving reading order and " +
      "structure (headings, lists, tables). Output only the extracted text, no commentary."
  );
}

async function extractFromImage(buffer: Buffer, mimeType: string): Promise<string> {
  return extractWithGemini(
    buffer,
    mimeType,
    "Transcribe all visible text from this image exactly as it appears, preserving structure " +
      "(labels, table rows, form fields). If it's a screenshot of a UI or document, include " +
      "field labels and their values. Output only the transcribed text, no commentary."
  );
}

export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string> {
  if (mimeType === DOCX_MIME) return extractFromDocx(buffer);
  if (mimeType === XLSX_MIME) return extractFromXlsx(buffer);
  if (mimeType === "application/pdf") return extractFromPdf(buffer);
  if (mimeType.startsWith(IMAGE_MIME_PREFIX)) return extractFromImage(buffer, mimeType);
  throw new Error(`Unsupported mime type for extraction: ${mimeType} (${filename})`);
}
