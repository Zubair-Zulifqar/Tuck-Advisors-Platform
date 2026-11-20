# Architecture

## Overview

```mermaid
flowchart LR
  subgraph Clients
    V[Website visitor]
    S[Staff browser]
    X[Chrome extension<br/>side panel + content scripts]
  end
  subgraph Web["apps/web — Next.js"]
    P[Public site + Analyzer]
    H[Internal hub (RSC)]
    A[REST API /api/*<br/>route() wrapper: auth · RBAC · rate limit · zod]
    W[Inline worker<br/>(PGlite mode)]
  end
  subgraph Core["packages"]
    E[engine<br/>research · automation · outreach]
    I[integrations<br/>adapters + mocks]
    D[db<br/>repos · withOrg/RLS]
  end
  PG[(PostgreSQL<br/>Supabase / Cloud SQL / PGlite)]
  PY[services/ai-research<br/>FastAPI Fit Score]
  WK[apps/workers]
  EXT[(OpenAI · Exa · Apollo · RocketReach<br/>Pipeline CRM · Resend · Google · Reddit · Zapier)]

  V --> P --> A
  S --> H --> D
  S --> A
  X -- Bearer token --> A
  A --> E --> D --> PG
  E --> I --> EXT
  I --> PY
  W --> E
  WK --> E
  EXT -- signed webhooks --> A
```

## Layers

| Layer | Responsibility | Never does |
| --- | --- | --- |
| `apps/web` routes/pages | AuthN/Z, validation, HTTP mapping, rendering | Talk to third parties directly |
| `packages/engine` | Business workflows (research jobs, scoring, automation, outreach, newsletters) | Know about HTTP/Next.js |
| `packages/integrations` | One adapter per provider: config, retries, rate limits, typed errors, mock | Contain business rules |
| `packages/db` | SQL repositories, org-scoped transactions, migrations | Call external services |
| `packages/shared` | Zod schemas, roles, types shared by web, engine and extension | Server-only code |
| `services/ai-research` | Deterministic, explainable scoring & classification | Use LLM output as verified data |

## Request lifecycle (authenticated API)

1. `route()` resolves the caller from the `Authorization: Bearer` token (extension) or the `tuck_session` cookie (web).
   Cookie requests that change state must carry a same-origin `Origin` header (CSRF).
2. The membership is reloaded from the DB on every request, so role changes/removals apply immediately.
3. Permission check (`roleHas`), per-user rate limit, zod body validation.
4. `withOrg()` opens a transaction, sets `request.jwt.claim.sub`/`app.user_id` and `SET LOCAL ROLE authenticated`,
   so RLS policies and audit triggers see the real actor.
5. Errors map to JSON `{ error: { message, details } }` with 401/403/404/409/422/429/502 statuses.

## Background processing

All queues are PostgreSQL tables claimed with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`:
`research_jobs`, `automation_executions` (incl. delays via `resume_at`), `tasks.follow_up_notified_at`,
`outreach_messages` and `newsletters`. Any number of workers can run concurrently without double-processing.

Runners: the inline worker (local PGlite — only one process may open the embedded DB), `apps/workers` (long-running
container), or `GET /api/internal/cron` (Vercel Cron, `CRON_SECRET`).

**Why not BullMQ/Redis?** Jobs are low-volume and must be transactional with the CRM rows they touch; a Postgres queue
gives exactly-once claiming, durable history (the execution log *is* the queue) and one less service. If throughput ever
requires it, `runAllQueues` can be triggered by BullMQ repeatable jobs or a Redis notification without changing the
engine — only the scheduling layer changes.

## Data flow for AI output

Retrieved documents become `ResearchSource` records (`id`, `url`, `provider`, `retrievedAt`, `excerpt`). LLM output is
validated against zod schemas where every statement is a `claim` with `provenance` (`sourced` | `assessment` |
`unknown`). `sanitizeClaims()` drops source ids the model invented and downgrades unsupported "sourced" claims.
Only non-unknown claims become scoring facts; revenue is used only when `revenue_verified` is true.
