import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export async function GET() {
  const rows = await sql`
    select c.id, c.name, c.created_at,
           count(d.id)::int as document_count
    from clients c
    left join documents d on d.client_id = c.id
    group by c.id
    order by c.name asc
  `;
  const general = await sql`select count(*)::int as n from documents where client_id is null`;
  return NextResponse.json({ clients: rows, generalCount: general[0].n as number });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (user?.role !== "admin") {
    return NextResponse.json({ error: "Only an administrator can add clients" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Client name is required" }, { status: 400 });

  const existing = await sql`select 1 from clients where lower(name) = lower(${name})`;
  if (existing[0]) return NextResponse.json({ error: "A client with that name already exists" }, { status: 409 });

  const rows = await sql`insert into clients (name) values (${name}) returning id, name, created_at`;
  return NextResponse.json({ client: rows[0] });
}
