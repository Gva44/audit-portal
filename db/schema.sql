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

-- Original column headers, in order, for a questionnaire parsed from a structured
-- Excel/Word table (via src/lib/questionnaire-table.ts) — lets export rebuild the
-- client's original layout. Null for questionnaires parsed as plain text (e.g. PDFs).
alter table documents add column if not exists column_headers jsonb;

-- Individual questions parsed out of a 'questionnaire' document, each with an
-- AI-generated answer drawn from policy/evidence documents via semantic search.
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  position int not null,
  question_text text not null,
  answer_text text,
  -- Array of {"id": "<document uuid>", "filename": "..."} for the policy/evidence
  -- docs the answer was drawn from.
  citations jsonb not null default '[]'::jsonb,
  answer_status text not null default 'pending' check (answer_status in ('pending', 'generating', 'ok', 'failed')),
  answer_error text,
  created_at timestamptz not null default now()
);

-- The original row's cell values, keyed by header (e.g. {"Documents Needed": "...",
-- "Yes/No/NA": "..."}), for questions parsed from a structured table. Null for
-- plain-text-parsed questions.
alter table questions add column if not exists row_data jsonb;

-- Short classification of the answer (e.g. "Yes", "No", "Partial", "NA", or free text
-- for non-boolean questions), separate from answer_text's narrative justification.
alter table questions add column if not exists response_value text;

alter table questions add column if not exists confidence_level text
  check (confidence_level in ('high', 'medium', 'low'));
alter table questions add column if not exists confidence_score numeric;

-- Populated when the answer represents a gap (weak/no evidence) — a suggested next
-- step such as "draft a policy for X" or "provide evidence by <date>".
alter table questions add column if not exists suggested_action text;

-- Embedding of question_text, populated the first time an answer is generated for this
-- question (reuses the same vector already computed for policy/evidence retrieval — see
-- generateAnswer in src/lib/questions.ts). Lets a *future* questionnaire's questions find
-- this one as a prior-year match, without needing any manual linking between files.
alter table questions add column if not exists embedding vector(768);

-- The prior question (from a different questionnaire, likely last year's) whose answer
-- was used as reference context when generating this one, if a close-enough match existed.
alter table questions add column if not exists prior_question_id uuid references questions(id);

create index if not exists questions_document_id_idx on questions (document_id);

create index if not exists questions_embedding_idx on questions
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
