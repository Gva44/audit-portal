-- Audit Portal schema
-- Run this once against your Neon database (see scripts/init-db.ts / `npm run db:init`)

create extension if not exists vector;
create extension if not exists pgcrypto; -- for gen_random_uuid()

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  category text not null check (category in ('policy', 'evidence', 'questionnaire')),
  notes text,
  mime_type text not null,
  file_size bigint not null,
  drive_file_id text not null unique,
  drive_web_link text not null,
  extracted_text text,
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'ok', 'failed')),
  extraction_error text,
  -- Gemini's gemini-embedding-001 model, requested at 768 dimensions (see src/lib/embeddings.ts).
  -- If you change EMBEDDING_DIMENSIONS there, this column must match or inserts will fail.
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index if not exists documents_category_idx on documents (category);
create index if not exists documents_created_at_idx on documents (created_at desc);

-- Full-text (keyword) search index over filename + extracted text
create index if not exists documents_fts_idx on documents
  using gin (to_tsvector('english', coalesce(filename, '') || ' ' || coalesce(extracted_text, '')));

-- Approximate nearest-neighbor index for semantic search.
-- ivfflat needs rows in the table to build well; fine to create up front on an empty table
-- for this project's small-scale (single-org) use, cosine distance matches Gemini embeddings.
create index if not exists documents_embedding_idx on documents
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
