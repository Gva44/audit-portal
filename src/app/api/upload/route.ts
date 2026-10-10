import { NextRequest, NextResponse } from "next/server";
import { uploadFile } from "@/lib/drive";
import { extractDocumentText, XLSX_MIME } from "@/lib/extract";
import { generateEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { interpretColumnInstructions, parseAndSaveQuestions } from "@/lib/questions";
import { getClientFolderId } from "@/lib/clients";
import type { ColumnConfig } from "@/lib/questionnaire-table";
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
  const clientIdRaw = form.get("clientId");
  const columnInstructionsRaw = form.get("columnInstructions");

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

  // "general" (or empty) = the shared pool; otherwise a client id.
  const clientId = typeof clientIdRaw === "string" && clientIdRaw && clientIdRaw !== "general" ? clientIdRaw : null;
  if (clientId) {
    const exists = await sql`select 1 from clients where id = ${clientId}`;
    if (!exists[0]) return NextResponse.json({ error: "Unknown client" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const folderId = clientId ? await getClientFolderId(clientId) : null;
  const { id: driveFileId, webViewLink } = await uploadFile(buffer, file.name, file.type, folderId);

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
  const columnInstructions =
    category === "questionnaire" && typeof columnInstructionsRaw === "string" && columnInstructionsRaw.trim()
      ? columnInstructionsRaw.trim()
      : null;

  const rows = await sql`
    insert into documents (
      filename, category, notes, mime_type, file_size, drive_file_id, drive_web_link,
      extracted_text, extraction_status, extraction_error, embedding, client_id, column_instructions
    )
    values (
      ${file.name}, ${category}, ${notesValue}, ${file.type}, ${file.size}, ${driveFileId}, ${webViewLink},
      ${extractedText}, ${extractionStatus}, ${extractionError}, ${embeddingLiteral}::vector,
      ${clientId}, ${columnInstructions}
    )
    returning id, filename, category, notes, mime_type, file_size, extraction_status, created_at
  `;
  const document = rows[0];

  let warning: string | null = null;
  if (category === "questionnaire") {
    try {
      let config: ColumnConfig | null = null;
      if (columnInstructions) {
        try {
          config = await interpretColumnInstructions(buffer, file.type, columnInstructions);
          await sql`update documents set column_config = ${JSON.stringify(config)}::jsonb where id = ${document.id}`;
        } catch (err) {
          // Falls back to automatic column detection; the questionnaire page lets the
          // uploader pick columns by hand and re-read.
          warning = `Could not apply your column instructions (${err instanceof Error ? err.message : "unknown error"}); columns were detected automatically.`;
        }
      }
      await parseAndSaveQuestions(document.id, buffer, file.type, extractedText, config);
    } catch (err) {
      // The document itself is saved either way; questions can be extracted later
      // from its detail page, so this isn't fatal to the upload.
      console.error("Question extraction failed:", err);
    }
  }

  return NextResponse.json({ document, warning });
}
