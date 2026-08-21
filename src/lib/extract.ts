import mammoth from "mammoth";
import { getGemini } from "./gemini";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const IMAGE_MIME_PREFIX = "image/";

// Verify this is still current at https://ai.google.dev/gemini-api/docs/models.
// gemini-flash-latest is an alias that tracks Google's current best Flash model.
const GEMINI_MODEL = "gemini-flash-latest";

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
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
  if (mimeType === "application/pdf") return extractFromPdf(buffer);
  if (mimeType.startsWith(IMAGE_MIME_PREFIX)) return extractFromImage(buffer, mimeType);
  throw new Error(`Unsupported mime type for extraction: ${mimeType} (${filename})`);
}
