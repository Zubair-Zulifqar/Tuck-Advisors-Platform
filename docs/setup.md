# Setup

## Prerequisites
- Node.js 22 (`.nvmrc`), npm 10 — the repo uses **npm workspaces** (`apps/*`, `packages/*`).
- Python 3.12+ for `services/ai-research`.
- Optional: Docker (full stack), Supabase CLI, Chrome.

## 1. Install
```bash
npm install
cd services/ai-research && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt && cd ../..
cp .env.example .env    # optional for local; fill only what you need
```

## 2. Run locally (embedded database)
```bash
# terminal 1 — Fit Score service
cd services/ai-research && .venv/bin/uvicorn tuck_scoring.app:app --port 8088

# terminal 2 — web app
SEED_PASSWORD='choose-a-local-password' SCORING_SERVICE_URL=http://127.0.0.1:8088 npm run dev
```
- Without `DATABASE_URL`, the app opens PGlite (real PostgreSQL in WASM) at `.data/pglite` (override with `PGLITE_DIR`),
  applies migrations and seeds demo data when `SEED_PASSWORD` is set.
- Background jobs run inside the web process every 4 s in this mode.
- Sign in at http://localhost:3000/login as `owner@tuck.example` / `admin@` / `analyst@` / `viewer@` with `SEED_PASSWORD`.
- Everything works without third-party keys (mock/website-only modes are labelled in the UI and `/api/health`).

## 3. Run against PostgreSQL
```bash
export DATABASE_URL=postgres://user:pass@host:5432/db
npm run db:migrate
SEED_PASSWORD=... npm run db:seed           # optional demo data (refuses in production)
npm run dev                                  # web
npx tsx apps/workers/src/index.ts            # worker (or: npm run start -w @tuck/workers)
```
The DB user must be able to `SET ROLE authenticated` (see `infrastructure/gcp/cloud-sql.md`).

## 4. Full stack with Docker
```bash
cp .env.example .env && $EDITOR .env         # set SESSION_SECRET at minimum
docker compose -f infrastructure/docker-compose.yml up --build
```

## 5. Chrome extension
```bash
TUCK_API_BASE_URL=http://localhost:3000 npm run build -w @tuck/extension
```
Load `apps/extension/dist` via `chrome://extensions` → Developer mode → Load unpacked. In production set
`EXTENSION_IDS=<your extension id>` on the web app so CORS allows it.

## 6. Enabling integrations
Set the variables in `.env.example`; restart. Check **Settings → Integrations** or `GET /api/health`.
| Feature | Variables |
| --- | --- |
| AI | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Web research | `EXA_API_KEY` |
| Enrichment | `APOLLO_API_KEY` and/or `ROCKETREACH_API_KEY` |
| Pipeline CRM | `PIPELINE_CRM_API_KEY`, `PIPELINE_CRM_APP_KEY`, `PIPELINE_CRM_FIT_SCORE_FIELD` |
| Email | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `NEWSLETTER_FROM` |
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` |
| Webhooks | `WEBHOOK_SIGNING_SECRET` |
| Supabase Auth | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
