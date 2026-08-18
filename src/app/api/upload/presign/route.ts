import { NextRequest, NextResponse } from "next/server";
import { makeObjectKey, presignPutUrl } from "@/lib/r2";

const ALLOWED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const filename = body?.filename;
  const mimeType = body?.mimeType;

  if (typeof filename !== "string" || typeof mimeType !== "string") {
    return NextResponse.json({ error: "filename and mimeType are required" }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${mimeType}. Allowed: .docx, .pdf, .png, .jpg, .webp, .gif` },
      { status: 400 }
    );
  }

  const key = makeObjectKey(filename);
  const uploadUrl = await presignPutUrl(key, mimeType);

  return NextResponse.json({ key, uploadUrl });
}
