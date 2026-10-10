import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

// `client` filter: omitted/"all" = everything, "general" = the shared pool only, or a
// client id = that client's documents.
export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category");
  const client = request.nextUrl.searchParams.get("client");
  const clientFilter = !client || client === "all" ? null : client;

  const rows = await sql`
    select d.id, d.filename, d.category, d.notes, d.mime_type, d.file_size, d.extraction_status,
           d.created_at, d.client_id, c.name as client_name
    from documents d
    left join clients c on c.id = d.client_id
    where (${category}::text is null or d.category = ${category})
      and (
        ${clientFilter}::text is null
        or (${clientFilter}::text = 'general' and d.client_id is null)
        or d.client_id::text = ${clientFilter}::text
      )
    order by d.created_at desc
  `;

  return NextResponse.json({ documents: rows });
}
