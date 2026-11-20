# Testing

```bash
npm run typecheck                         # tsc across all workspaces
npm test                                  # vitest in every workspace
npm run test -w @tuck/db                  # one workspace
npm run test:py                           # pytest (services/ai-research/.venv)
node scripts/scan-secrets.mjs             # secret scan
```

CI (`.github/workflows/ci.yml`) runs secret scan, typecheck, all vitest suites, web and extension production builds, and
pytest on Python 3.12.

| Suite | Location | Covers |
| --- | --- | --- |
| Shared | `packages/shared/test` | Domain/name normalisation, SSRF URL guard, claim provenance rules, role permissions, template rendering, schemas |
| Database | `packages/db/test` | Migrations (idempotent) on real PostgreSQL (PGlite); **RLS isolation** between orgs, cross-org insert blocked, viewer write blocked; audit trail with actor + diffs; duplicate detection; provider-verified email cannot be self-declared; stage-change activities |
| Integrations | `packages/integrations/test` | Retries on 5xx, no retry on 401/403, 429 + Retry-After, network failures, rate limiter, OpenAI JSON repair & failure, mock refusal in production, Exa mapping, website fetcher (robots, private IP / DNS rebinding), Apollo/RocketReach verification rules, mock never fabricates, Pipeline CRM requests, Svix & HMAC webhooks with replay window, AES-GCM secrets, Gmail address parsing, Reddit signals, scoring response validation, registry hides secret values |
| Engine | `packages/engine/test` | Automation dispatch/dedupe/skip, delays, approval gate, retries/failure/manual retry, paused automations; research jobs (sourced reports, unknown revenue, failure reasons); analyzer schema validity, disclaimer, `insufficient_data` without scoring, private-URL rejection; enrichment mock; fit score persistence & CRM sync; outreach segmentation/suppression/four-eyes approval/compliance/daily limit/bounce suppression; newsletter approval & consent-only delivery; Reddit signal storage & conversion |
| Workers | `apps/workers/test` | Queue pass orchestration |
| Extension | `apps/extension/test` | Manifest/permission policy, URL context detection, LinkedIn company & person and Gmail parsers (synthetic fixtures), auth refresh single-flight, 401 retry, logout, API error mapping (409/network/timeout), side-panel XSS escaping |
| Scoring (Python) | `services/ai-research/tests` | Every signal, missing data, required criteria, exclusions, thresholds, determinism, explanations, unverified revenue ignored, bucket priority, API auth & 422, Lambda handler, batch scorer |

All fixtures are synthetic (`*.example` domains); no real customer data is used.

Manual smoke test (local): sign in, browse every `/app/*` page, create a company (duplicate → 409), run a research job,
calculate a fit score, extension login/refresh rotation/reuse detection, CSRF rejection without `Origin`, analyzer SSRF rejection.

Not yet implemented: Playwright browser E2E suite (the `test:e2e` script is a placeholder until `apps/web/e2e` exists).
