import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category");

  const rows = category
    ? await sql`
        select id, filename, category, notes, mime_type, file_size, extraction_status, created_at
        from documents
        where category = ${category}
        order by created_at desc
      `
    : await sql`
        select id, filename, category, notes, mime_type, file_size, extraction_status, created_at
        from documents
        order by created_at desc
      `;

  return NextResponse.json({ documents: rows });
}
