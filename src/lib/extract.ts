import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { getOpenAI } from "./openai";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const IMAGE_MIME_PREFIX = "image/";

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

async function extractFromPdf(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractPdfText(pdf, { mergePages: true });
  return text.trim();
}

async function extractFromImage(buffer: Buffer, mimeType: string): Promise<string> {
  const base64 = buffer.toString("base64");
  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Transcribe all visible text from this image exactly as it appears, preserving structure (labels, table rows, form fields). " +
              "If it's a screenshot of a UI or document, include field labels and their values. Output only the transcribed text, no commentary.",
          },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      },
    ],
    max_tokens: 4096,
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
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
