import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { generateEmbedding, toVectorLiteral } from "@/lib/embeddings";

// Snippet text comes from user-uploaded documents, so we never render it as raw HTML.
// ts_headline wraps matches with this control-character delimiter instead of <b>/</b>;
// the client splits on it and renders matches as React elements (auto-escaped).
// Defined via fromCharCode (rather than a literal control char) to keep this file plain text.
export const HIGHLIGHT_DELIM = String.fromCharCode(1);
const HEADLINE_OPTIONS = `MaxFragments=1,MaxWords=40,MinWords=15,StartSel=${HIGHLIGHT_DELIM},StopSel=${HIGHLIGHT_DELIM}`;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  const category = request.nextUrl.searchParams.get("category");

  if (!q) return NextResponse.json({ results: [] });

  let embeddingLiteral: string | null = null;
  try {
    embeddingLiteral = toVectorLiteral(await generateEmbedding(q));
  } catch (err) {
    console.error("Query embedding failed, falling back to keyword-only search:", err);
  }

  // Hybrid ranking: blend keyword relevance (ts_rank) with semantic similarity
  // (1 - cosine distance). Falls back to keyword-only if embedding generation failed.
  const rows = embeddingLiteral
    ? await sql`
        select id, filename, category, notes, mime_type, extraction_status, created_at,
               ts_headline(
                 'english', coalesce(extracted_text, ''), plainto_tsquery('english', ${q}), ${HEADLINE_OPTIONS}
               ) as snippet,
               (
                 coalesce(ts_rank(
                   to_tsvector('english', coalesce(filename, '') || ' ' || coalesce(extracted_text, '')),
                   plainto_tsquery('english', ${q})
                 ), 0) * 0.4
                 + coalesce(1 - (embedding <=> ${embeddingLiteral}::vector), 0) * 0.6
               ) as score
        from documents
        where (${category}::text is null or category = ${category})
          and (
            to_tsvector('english', coalesce(filename, '') || ' ' || coalesce(extracted_text, ''))
              @@ plainto_tsquery('english', ${q})
            or embedding is not null
          )
        order by score desc
        limit 25
      `
    : await sql`
        select id, filename, category, notes, mime_type, extraction_status, created_at,
               ts_headline(
                 'english', coalesce(extracted_text, ''), plainto_tsquery('english', ${q}), ${HEADLINE_OPTIONS}
               ) as snippet,
               ts_rank(
                 to_tsvector('english', coalesce(filename, '') || ' ' || coalesce(extracted_text, '')),
                 plainto_tsquery('english', ${q})
               ) as score
        from documents
        where (${category}::text is null or category = ${category})
          and to_tsvector('english', coalesce(filename, '') || ' ' || coalesce(extracted_text, ''))
            @@ plainto_tsquery('english', ${q})
        order by score desc
        limit 25
      `;

  return NextResponse.json({ results: rows });
}
