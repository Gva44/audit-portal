import { NextRequest, NextResponse } from "next/server";
import { getObjectBuffer } from "@/lib/r2";
import { extractDocumentText } from "@/lib/extract";
import { generateEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { sql, type Category } from "@/lib/db";

// Allow extra time for larger PDFs / vision OCR on Vercel.
export const maxDuration = 60;

const CATEGORIES = new Set<Category>(["policy", "evidence", "questionnaire"]);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const key = body?.key;
  const filename = body?.filename;
  const mimeType = body?.mimeType;
  const fileSize = body?.fileSize;
  const category = body?.category;
  const notes = typeof body?.notes === "string" ? body.notes : null;

  if (
    typeof key !== "string" ||
    typeof filename !== "string" ||
    typeof mimeType !== "string" ||
    typeof fileSize !== "number" ||
    typeof category !== "string"
  ) {
    return NextResponse.json({ error: "Missing or invalid required fields" }, { status: 400 });
  }
  if (!CATEGORIES.has(category as Category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const buffer = await getObjectBuffer(key);

  let extractedText = "";
  let extractionStatus: "ok" | "failed" = "ok";
  let extractionError: string | null = null;
  try {
    extractedText = await extractDocumentText(buffer, mimeType, filename);
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

  const rows = await sql`
    insert into documents (
      filename, category, notes, mime_type, file_size, r2_key,
      extracted_text, extraction_status, extraction_error, embedding
    )
    values (
      ${filename}, ${category}, ${notes}, ${mimeType}, ${fileSize}, ${key},
      ${extractedText}, ${extractionStatus}, ${extractionError}, ${embeddingLiteral}::vector
    )
    returning id, filename, category, notes, mime_type, file_size, extraction_status, created_at
  `;

  return NextResponse.json({ document: rows[0] });
}
