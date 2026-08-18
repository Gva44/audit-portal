# Audit Portal

Internal document library for audit/compliance policies and evidence. Upload
Word docs, PDFs, and images; text is extracted automatically (OCR/vision for
images), stored alongside the original file, and embedded for keyword +
semantic search — the foundation for AI-assisted questionnaire answers later.

**Stack:** Next.js (App Router) on Vercel, Neon Postgres + pgvector, Cloudflare
R2 for file storage, OpenAI for embeddings and image OCR, single-password gate
for auth.

## 1. Prerequisites

You'll need accounts (all have free tiers) for:

- **Neon** — https://neon.tech (Postgres database)
- **Cloudflare** — https://dash.cloudflare.com (R2 object storage)
- **OpenAI** — https://platform.openai.com (embeddings + image OCR)
- **Vercel** — https://vercel.com (hosting)
- A **GitHub** repo for this project (Vercel deploys from GitHub)

## 2. Set up Neon (database)

1. Create a project at https://console.neon.tech.
2. Open the project's **Connect** panel and copy the **pooled** connection
   string (it contains `-pooler` in the hostname) — this is required for
   serverless/Vercel use. It looks like:
   `postgres://user:password@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require`
3. Put it in `.env.local` as `DATABASE_URL` (see step 5).
4. pgvector is already enabled on Neon by default — the schema below just
   turns it on with `create extension if not exists vector`.

You do **not** need to manually create tables in the console — the schema is
applied by a script (step 6).

## 3. Set up Cloudflare R2 (file storage)

1. In the Cloudflare dashboard, go to **R2 Object Storage** → **Create bucket**.
   Name it e.g. `audit-portal-documents`. Location: Automatic.
2. Go to **R2** → **Manage API tokens** → **Create API token**.
   - Permissions: **Object Read & Write**
   - Scope it to the bucket you just created (not account-wide, if offered).
3. Copy the values it gives you into `.env.local`:
   - `R2_ACCOUNT_ID` — shown on the R2 overview page (or in the token's endpoint URL)
   - `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` — shown once when the token is created, save them now
   - `R2_BUCKET_NAME` — the bucket name from step 1

The app talks to R2 via the S3-compatible API (presigned URLs) — no public
bucket access is needed; files stay private and are served through
short-lived signed links.

## 4. Set up OpenAI

1. Create an API key at https://platform.openai.com/api-keys.
2. Put it in `.env.local` as `OPENAI_API_KEY`.
3. Add a small amount of billing credit — this app uses
   `text-embedding-3-small` (embeddings) and `gpt-4o-mini` (image OCR), both
   inexpensive (fractions of a cent per document at this scale).

## 5. Configure environment variables locally

```bash
cp .env.example .env.local
```

Fill in `DATABASE_URL`, the `R2_*` values, `OPENAI_API_KEY`, and:

- `APP_PASSWORD` — the password you'll type in to access the app
- `APP_SECRET` — a random string used to sign the session cookie, e.g.
  generate one with `node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"`

## 6. Install dependencies and initialize the database schema

```bash
npm install
npm run db:init
```

`db:init` applies [`db/schema.sql`](db/schema.sql) to your Neon database
(creates the `documents` table, pgvector extension, full-text and vector
indexes). It's safe to re-run — everything is `create if not exists`.

## 7. Run locally

```bash
npm run dev
```

Open http://localhost:3000 — you'll land on the login page, then Library/Upload.

## 8. Deploy to Vercel

1. Push this repo to GitHub:
   ```bash
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
2. In Vercel, **Add New Project** → import the GitHub repo.
3. Under **Environment Variables**, add all the same variables from
   `.env.local` (`DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `OPENAI_API_KEY`,
   `APP_PASSWORD`, `APP_SECRET`).
4. Deploy. Vercel will give you a public `*.vercel.app` URL — that's your
   on-demand, browser-accessible app. Every push to `main` auto-deploys.

Neon's free tier auto-suspends after inactivity and wakes on the next query
(a few hundred ms of extra latency on the first request) — no manual
unpausing needed.

### A note on upload size / time limits

Uploads go browser → R2 directly via a presigned URL (not through a Vercel
function), so large files aren't limited by Vercel's request body size. Text
extraction + embedding happens in a server function after upload
(`/api/upload/finalize`), capped at 60s (`maxDuration`) — plenty for typical
policy/evidence documents. If you start uploading very large PDFs and hit
timeouts, that's the first place to look.

## How it works

- **Upload** (`/upload`): client requests a presigned R2 PUT URL, uploads the
  file directly to R2, then calls `/api/upload/finalize` which downloads the
  object server-side, extracts text (`mammoth` for .docx, `unpdf` for PDF,
  GPT-4o-mini vision for images), generates an OpenAI embedding, and stores
  everything in Neon.
- **Library** (`/library`): lists documents from Neon, filterable by category,
  with an expandable view of the extracted text and a link to the original
  file (served via a short-lived presigned R2 URL).
- **Search**: `/api/search` blends Postgres full-text search (`ts_rank`) with
  pgvector cosine similarity on the query's embedding, so both exact keyword
  matches and conceptually related documents surface.
- **Auth**: a single shared password (`APP_PASSWORD`), gated by `src/proxy.ts`
  (Next.js middleware) checking a signed session cookie. No user accounts.

## Project structure

```
db/schema.sql              Postgres schema (pgvector, documents table, indexes)
scripts/init-db.mjs        Applies db/schema.sql — run via `npm run db:init`
src/lib/db.ts              Neon client
src/lib/r2.ts              R2 (S3-compatible) client + presigned URL helpers
src/lib/extract.ts         Text extraction: docx / pdf / image OCR
src/lib/embeddings.ts      OpenAI embedding generation
src/lib/auth.ts            Password check + signed session cookie helpers
src/proxy.ts               Auth gate (redirects to /login when unauthenticated)
src/app/upload/            Upload page
src/app/library/           Library + search page
src/app/api/               Route handlers (presign, finalize, documents, search, login)
```

## Out of scope for this phase

Questionnaire upload/parsing, AI-generated answers, confidence scoring,
contradiction detection, and multi-user accounts are intentionally not built
yet — this phase is the document ingestion + search foundation for that work.
