# Tuck Advisors Platform

An AI-assisted M&A advisory platform: a public advisory website with an **M&A Analyzer**, an internal
**operations hub and CRM**, an **AI research engine**, a Python **M&A Matrix / AI Fit Score** service, an
event-driven **CRM automation engine**, a human-gated **bulk outreach** system, and a Manifest V3 **Chrome
extension** that turns LinkedIn, Gmail and the CRM into a deal workstation.

> Portfolio / reference implementation. All demo companies and people are fictional (`*.example` domains).
> External integrations run in clearly labelled **mock mode** until credentials are configured.

## Systems

| System | Where | Highlights |
| --- | --- | --- |
| Public website | `apps/web/src/app/(site)` | Home, About, Services, Sell-side, Buy-side, Acquisition criteria, Contact (lead capture with consent + honeypot), M&A Analyzer, Privacy, Terms, Unsubscribe |
| M&A Analyzer | `/analyzer`, `POST /api/public/analyze` | SSRF-guarded retrieval of both companies' public sites (+ Exa search when configured), structured profiles where every claim is `sourced` / `assessment` / `unknown`, deterministic Fit Score, risks, considerations, sources with retrieval timestamps, disclaimer, opt-in save (180-day expiry) |
| Internal hub | `apps/web/src/app/app` | Dashboard (live DB counts), companies, contacts, pipeline board, tasks, research workspace, M&A Matrix, Reddit deal sourcing, communications, outreach campaigns, newsletters, automations, settings (members/roles, integration status, audit log) |
| AI research engine | `packages/engine/src/research` | Business overviews, positioning statements, capital-raise detection (human review required), acquisition analysis, similar-company & buyer discovery, pre-call briefs, post-call notes → tasks, buyer bucket classification; background job queue with retries |
| Fit Score service | `services/ai-research` (FastAPI) | Configurable weighted matrix, required criteria, exclusion rules, missing-data handling, coverage & confidence, versioned models, explanations; Lambda handler and Postgres batch scorer |
| CRM | `packages/db` + `supabase/migrations` | Organisations, companies, contacts, buyers, targets, opportunities, deals, activities, tasks, custom fields, tags, duplicate detection, CSV import/export, audit triggers, RLS |
| Automation engine | `packages/engine/src/automation` | Triggers, conditions, actions, delays, retries with backoff, dedupe keys, execution logs, approval gates, pause/disable, visual builder, template library |
| Bulk outreach | `packages/engine/src/outreach` | Segmentation, suppression lists, 30-day duplicate prevention, AI personalisation, compliance checks, four-eyes approval, daily send limits, bounce/complaint/reply handling, analytics |
| Chrome extension | `apps/extension` | MV3 side panel for LinkedIn company/person pages, Gmail threads and the Tuck CRM; `sidePanel` + `storage` permissions only; rotating refresh tokens |
| Integrations | `packages/integrations` | OpenAI, Exa, Apollo, RocketReach, Pipeline CRM, Resend, Gmail/Docs/Google OAuth clients, Reddit Data API, Zapier/Apps Script webhooks — each with retries, rate limiting, typed errors and a mock |

## Architecture

TypeScript monorepo (npm workspaces) + one Python service. See [docs/architecture.md](docs/architecture.md).

```
apps/web            Next.js 15 (App Router) — public site, internal hub, REST API (/api/*)
apps/extension      Chrome MV3 extension (esbuild, vitest + jsdom)
apps/workers        Standalone queue worker for Postgres deployments
packages/shared     Zod schemas, roles/permissions, shared types
packages/db         SQL driver (pg / PGlite), migrations runner, repositories, seed
packages/integrations  Third-party adapters + mocks
packages/engine     Business logic: research, scoring orchestration, automation, outreach, newsletters
services/ai-research   Python Fit Score engine (FastAPI, Lambda, batch)
supabase/migrations    PostgreSQL schema, RLS policies, retention functions
infrastructure      Docker, docker-compose, AWS SAM, Cloud SQL & Supabase notes
docs                Architecture and module documentation
```

## Quick start (no Docker, no accounts needed)

Requirements: Node 22, Python 3.12+.

```bash
npm install

# Python Fit Score service
cd services/ai-research
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn tuck_scoring.app:app --port 8088 &
cd ../..

# Web app with embedded PostgreSQL (PGlite) — migrations and demo seed run automatically
SEED_PASSWORD='choose-a-local-password' SCORING_SERVICE_URL=http://127.0.0.1:8088 npm run dev
```

Open http://localhost:3000 and sign in at `/login` as `owner@tuck.example`, `admin@tuck.example`,
`analyst@tuck.example` or `viewer@tuck.example` with your `SEED_PASSWORD`.

With the embedded database, background jobs run inside the web process. For a production-like stack
(Postgres + web + worker + scoring) use `docker compose -f infrastructure/docker-compose.yml up --build`.
See [docs/setup.md](docs/setup.md).

### Chrome extension

```bash
TUCK_API_BASE_URL=http://localhost:3000 npm run build -w @tuck/extension
# chrome://extensions → Developer mode → Load unpacked → apps/extension/dist
```

## Tests

```bash
npm run typecheck          # all workspaces
npm test                   # vitest: shared, db (real Postgres via PGlite incl. RLS), integrations, engine, workers, extension
npm run test:py            # pytest: scoring engine, buckets, API, Lambda, batch
node scripts/scan-secrets.mjs
```

See [docs/testing.md](docs/testing.md).

## Integration modes

`GET /api/health` and **Settings → Integrations** report each integration's mode. Values of secrets are never shown.

| Integration | Env | When not configured |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | Mock LLM: deterministic extraction from retrieved sources only (labelled in UI). Refuses to start in production. |
| Exa | `EXA_API_KEY` | Website-only retrieval; search/discovery features report that search is unavailable |
| Fit Score service | `SCORING_SERVICE_URL` | Scores return `insufficient_data` — never a fabricated number |
| Apollo / RocketReach | `APOLLO_API_KEY`, `ROCKETREACH_API_KEY` | Mock always returns "not found" — never invents emails |
| Pipeline CRM | `PIPELINE_CRM_API_KEY` | In-memory mock adapter |
| Resend | `RESEND_API_KEY` | Simulated sends, recorded as simulated. Refuses in production. |
| Resend webhooks | `RESEND_WEBHOOK_SECRET` | Disabled (503) |
| Google OAuth / Gmail / Docs | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Disabled; Docs export returns copyable text |
| Reddit Data API | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Labelled `[Sample data]` posts |
| Zapier / Apps Script | `WEBHOOK_SIGNING_SECRET` | Inbound webhook disabled; `webhook.post` action fails with a clear error |
| PostgreSQL | `DATABASE_URL` | Embedded PGlite (development only) |

## Security highlights

- Organisation isolation enforced twice: every query filters by `organization_id`, **and** each request runs in a
  transaction as the Postgres `authenticated` role with the caller's id set, so Supabase RLS policies apply server-side.
- Role-based permissions (owner/admin/analyst/viewer) checked on every API route; DB triggers write field-level audit logs.
- HMAC-signed sessions (httpOnly, SameSite=Lax) + Origin-based CSRF checks; extension uses bearer tokens with rotating,
  hashed refresh tokens and reuse detection.
- Zod validation on all inputs, SSRF guard with DNS resolution checks for every server-side fetch, robots.txt respect,
  strict CSP and security headers, rate limiting on public and authenticated routes, signed webhooks (Svix / HMAC + replay window).
- No secrets in the browser or extension bundle; AES-256-GCM helper for credential storage.
- Human approval for outreach campaigns (by someone other than the author), newsletters and outbound webhooks.

Details: [docs/security.md](docs/security.md).

## Limitations

- No production deployment has been performed; Vercel/AWS/GCP/Supabase configs are templates.
- Third-party adapters were tested against mocked HTTP responses only. Apollo, RocketReach and Pipeline CRM endpoint
  shapes follow their public docs as understood at build time and **must be verified** against your account before enabling.
- The Google OAuth consent flow (routes to obtain and store user tokens) is not wired into the UI yet. The Gmail/Docs
  clients exist and Docs export accepts a user-supplied access token; reply detection currently arrives via the signed
  inbound webhook (e.g. from a Google Apps Script).
- `INTEGRATION_ENCRYPTION_KEY` / `encryptSecret` exist but integration credentials are currently read from environment
  variables; the `integrations` table is not yet populated by a settings UI.
- The in-memory rate limiter is per-instance; use Redis for multi-instance deployments.
- Playwright end-to-end tests are not included yet.
- Legal pages are templates and require review by counsel.

## License

MIT — see [LICENSE](LICENSE).
