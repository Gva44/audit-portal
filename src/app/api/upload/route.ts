import { NextRequest, NextResponse } from "next/server";
import { uploadFile } from "@/lib/drive";
import { extractDocumentText, XLSX_MIME } from "@/lib/extract";
import { generateEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { parseAndSaveQuestions } from "@/lib/questions";
import { sql, type Category } from "@/lib/db";

// Allow extra time for larger PDFs / Gemini OCR + embedding on Vercel.
// Note: the whole file travels through this function (Drive has no simple presigned-PUT
// pattern like S3), so uploads are also bounded by Vercel's serverless request body limit
// (~4.5MB by default) — see README for details if you need to raise it.
export const maxDuration = 60;

const ALLOWED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  XLSX_MIME, // .xlsx
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const CATEGORIES = new Set<Category>(["policy", "evidence", "questionnaire"]);

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });

  const file = form.get("file");
  const category = form.get("category");
  const notes = form.get("notes");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (typeof category !== "string" || !CATEGORIES.has(category as Category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}. Allowed: .docx, .xlsx, .pdf, .png, .jpg, .webp, .gif` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const { id: driveFileId, webViewLink } = await uploadFile(buffer, file.name, file.type);

  let extractedText = "";
  let extractionStatus: "ok" | "failed" = "ok";
  let extractionError: string | null = null;
  try {
    extractedText = await extractDocumentText(buffer, file.type, file.name);
  } catch (err) {
    extractionStatus = "failed";
    extractionError = err instanceof Error ? err.message : "Unknown extraction error";
  }

  let embeddingLiteral: string | null = null;
  if (extractedText.trim()) {
    try {
      embeddingLiteral = toVectorLiteral(await generateEmbedding(extractedText));
    } catch (err) {
      // Document is still saved without a vector; keyword search still works.
      console.error("Embedding generation failed:", err);
    }
  }

  const notesValue = typeof notes === "string" && notes.trim() ? notes : null;

  const rows = await sql`
    insert into documents (
      filename, category, notes, mime_type, file_size, drive_file_id, drive_web_link,
      extracted_text, extraction_status, extraction_error, embedding
    )
    values (
      ${file.name}, ${category}, ${notesValue}, ${file.type}, ${file.size}, ${driveFileId}, ${webViewLink},
      ${extractedText}, ${extractionStatus}, ${extractionError}, ${embeddingLiteral}::vector
    )
    returning id, filename, category, notes, mime_type, file_size, extraction_status, created_at
  `;
  const document = rows[0];

  if (category === "questionnaire") {
    try {
      await parseAndSaveQuestions(document.id, buffer, file.type, extractedText);
    } catch (err) {
      // The document itself is saved either way; questions can be extracted later
      // from its detail page, so this isn't fatal to the upload.
      console.error("Question extraction failed:", err);
    }
  }

  return NextResponse.json({ document });
}
