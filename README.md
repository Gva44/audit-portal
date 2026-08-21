# Audit Portal

Internal document library for audit/compliance policies and evidence. Upload
Word docs, PDFs, and images; text is extracted automatically (OCR/vision for
images), stored alongside the original file, and embedded for keyword +
semantic search — the foundation for AI-assisted questionnaire answers later.

**Stack:** Next.js (App Router) on Vercel, Neon Postgres + pgvector, Google
Drive for file storage, Gemini for text extraction/OCR and embeddings,
single-password gate for auth.

## 1. Prerequisites

- **Neon** — https://neon.tech (Postgres database)
- **Google Cloud** — https://console.cloud.google.com (service account for Drive access)
- **Google AI Studio** — https://aistudio.google.com (Gemini API key)
- **Vercel** — https://vercel.com (hosting)
- A **GitHub** repo for this project (Vercel deploys from GitHub)
- A Google Workspace account with Drive (you mentioned you already have this)

## 2. Set up Neon (database)

1. Create a project at https://console.neon.tech.
2. Open the project's **Connect** panel and copy the **pooled** connection
   string (it contains `-pooler` in the hostname) — required for
   serverless/Vercel use. Put it in `.env.local` as `DATABASE_URL`.
3. pgvector is enabled by the schema script itself (`create extension if not
   exists vector`) — nothing to do manually in the console.

## 3. Set up Google Drive storage (service account + folder)

This app writes files to Drive using a **service account** — a robot Google
identity, not your personal login — so it can upload without you having to
sign in interactively.

1. **Create a Google Cloud project** (or reuse one) at
   https://console.cloud.google.com/projectcreate.
2. **Enable the Drive API**: in that project, go to **APIs & Services** →
   **Library**, search "Google Drive API", click **Enable**.
3. **Create a service account**: **APIs & Services** → **Credentials** →
   **Create Credentials** → **Service account**. Give it any name (e.g.
   `audit-portal-drive`). No roles/permissions needed at the project level —
   access is granted later by sharing a specific folder.
4. **Create a key for it**: open the service account → **Keys** tab →
   **Add Key** → **Create new key** → JSON. This downloads a `.json` file —
   keep it safe, it's a credential.
5. **Base64-encode the whole JSON file** (so it fits as a single-line env
   var) and copy the output into `.env.local` as
   `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`:

   ```bash
   node -e "console.log(require('fs').readFileSync('path/to/your-key.json').toString('base64'))"
   ```

6. **Create a Shared Drive** for documents (in Google Drive, click **Shared
   drives** in the left sidebar → **+ New**, e.g. "Audit Portal"). This has
   to be a **Shared Drive**, not a regular folder in "My Drive" — service
   accounts have zero personal storage quota, so writes to a regular folder
   fail with `storageQuotaExceeded` even if it's shared with them as
   Editor. A Shared Drive's storage is billed to the Shared Drive itself,
   which service accounts can write into. (Shared Drives need a Business
   Standard/Plus or Enterprise Workspace plan — Business Starter doesn't
   support them.)
7. **Add the service account as a member** of the Shared Drive: open it →
   **Manage members** → add the service account's email (looks like
   `audit-portal-drive@your-project.iam.gserviceaccount.com`, shown on the
   service account's details page) → role **Content Manager** (or higher).
8. Open the Shared Drive and copy its ID from the URL — the string after
   `/folders/`: `https://drive.google.com/drive/folders/<THIS_IS_THE_ID>`.
   Put it in `.env.local` as `GOOGLE_DRIVE_FOLDER_ID`.
9. Add yourself as a member of the Shared Drive too (same **Manage
   members** dialog, your own email), and set `GOOGLE_DRIVE_OWNER_EMAIL` in
   `.env.local` to that address. The app also explicitly shares each
   uploaded file with this address as a safety net (see
   [`src/lib/drive.ts`](src/lib/drive.ts)), but being a Shared Drive member
   is what actually makes every file in it visible to you automatically.

## 4. Set up Gemini (extraction, OCR, embeddings)

1. Create an API key at https://aistudio.google.com/apikey (this can use
   the same Google Cloud project as the service account, or a separate one
   — either works).
2. Put it in `.env.local` as `GEMINI_API_KEY`.
3. Gemini's free tier covers light use; check current rate limits/pricing
   at https://ai.google.dev/gemini-api/docs/pricing if you expect heavy
   upload volume.

## 5. Configure environment variables locally

```bash
cp .env.example .env.local
```

Fill in `DATABASE_URL`, the `GOOGLE_*` values, `GEMINI_API_KEY`, and:

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
indexes). Safe to re-run — everything is `create if not exists`.

## 7. Run locally

```bash
npm run dev
```

Open http://localhost:3000 — you'll land on the login page, then Library/Upload.

## 8. Deploy to Vercel

1. Push this repo to GitHub:
   ```bash
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin master
   ```
2. In Vercel, **Add New Project** → import the GitHub repo.
3. Under **Environment Variables**, add all the same variables from
   `.env.local` (`DATABASE_URL`, `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`,
   `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_DRIVE_OWNER_EMAIL`, `GEMINI_API_KEY`,
   `APP_PASSWORD`, `APP_SECRET`).
4. Deploy. Vercel will give you a public `*.vercel.app` URL — that's your
   on-demand, browser-accessible app. Every push to `master` auto-deploys.

Neon's free tier auto-suspends after inactivity and wakes on the next query
(a few hundred ms of extra latency on the first request) — no manual
unpausing needed.

### A note on upload size limits

Unlike S3-style storage, the Google Drive API doesn't have a simple
presigned-URL pattern that lets the browser upload directly to storage — so
uploads go browser → our server → Drive, and are bounded by **Vercel's
serverless function request body limit (~4.5MB by default)**. That's plenty
for typical policy PDFs, Word docs, and screenshots. If you need to upload
larger files regularly, options include raising Vercel's limit on paid
plans, or (bigger change) switching to Drive's resumable-upload API with a
session URI the browser can PUT to directly — not implemented here since
it adds real complexity and isn't needed at this app's typical document
sizes.

### A note on model names

Google's Gemini model lineup moves fast. This app currently uses
`gemini-flash-latest` (an alias that tracks Google's current best Flash
model) for text/image extraction, and `gemini-embedding-001` for
embeddings — both set in [`src/lib/extract.ts`](src/lib/extract.ts) and
[`src/lib/embeddings.ts`](src/lib/embeddings.ts). If either starts
returning errors, check https://ai.google.dev/gemini-api/docs/models for
current model IDs and update those two constants. If you change the
embedding dimensionality, update the `vector(768)` column in
[`db/schema.sql`](db/schema.sql) to match.

## How it works

- **Upload** (`/upload`): client sends the file + category + notes as
  `multipart/form-data` to `/api/upload`, which uploads the file to Drive
  (via the service account), extracts text (`mammoth` for .docx, Gemini's
  native document understanding for PDFs, Gemini vision for image OCR),
  generates a Gemini embedding, and stores everything in Neon.
- **Library** (`/library`): lists documents from Neon, filterable by
  category, with an expandable view of the extracted text and a link to
  the original file (opens directly in Google Drive).
- **Search**: `/api/search` blends Postgres full-text search (`ts_rank`)
  with pgvector cosine similarity on the query's embedding, so both exact
  keyword matches and conceptually related documents surface.
- **Auth**: a single shared password (`APP_PASSWORD`), gated by
  `src/proxy.ts` (Next.js middleware) checking a signed session cookie. No
  user accounts.

## Project structure

```
db/schema.sql              Postgres schema (pgvector, documents table, indexes)
scripts/init-db.mjs        Applies db/schema.sql — run via `npm run db:init`
src/lib/db.ts               Neon client
src/lib/drive.ts            Google Drive upload/delete + owner-permission grant
src/lib/gemini.ts           Gemini client
src/lib/extract.ts          Text extraction: docx (mammoth) / pdf & image (Gemini)
src/lib/embeddings.ts       Gemini embedding generation
src/lib/auth.ts             Password check + signed session cookie helpers
src/proxy.ts                Auth gate (redirects to /login when unauthenticated)
src/app/upload/             Upload page
src/app/library/            Library + search page
src/app/api/                Route handlers (upload, documents, search, login)
```

## Out of scope for this phase

Questionnaire upload/parsing, AI-generated answers, confidence scoring,
contradiction detection, and multi-user accounts are intentionally not built
yet — this phase is the document ingestion + search foundation for that work.
