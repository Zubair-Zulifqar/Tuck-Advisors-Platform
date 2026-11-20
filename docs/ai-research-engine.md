# AI research engine

Code: `packages/engine/src/research/` (`engine.ts`, `jobs.ts`, `heuristics.ts`, `reddit.ts`). Providers come from
`packages/integrations` (`llm.ts`, `research.ts`, `enrichment.ts`, `scoring.ts`).

## Workflow

```mermaid
flowchart TD
  T[UI / extension / automation action] -->|POST /api/v1/research| Q[(research_jobs: queued)]
  Q -->|FOR UPDATE SKIP LOCKED| W[Worker: processResearchJob]
  W --> G[gatherCompanySources<br/>website fetcher: /, page, /about<br/>+ Exa search if configured]
  G --> L[LLM completeJson<br/>zod schema · 1 repair retry]
  L --> SAN[sanitizeClaims<br/>drop invented source ids,<br/>downgrade unsupported 'sourced']
  SAN --> R[(research_reports<br/>content + sources + providers)]
  R --> A[(activities: research)]
  R --> E[dispatchEvent research.completed]
  W -- retryable error --> Q
  W -- permanent error --> F[(status failed + last_error)]
```

Retries: provider errors marked `retryable` (timeouts, 5xx, 429) are re-queued with exponential backoff (30 s × 2^attempt,
max 3 attempts). Validation errors fail immediately with a readable reason (e.g. "Company needs a website or domain").

## Capabilities (`kind`)

| Kind | Output |
| --- | --- |
| `business_overview` | `CompanyProfile`: overview, industry, business model, products, customers, positioning, geography, revenue indicators, growth indicators — each a claim |
| `positioning_statement` | Statement, target customer, category, differentiators, proof points |
| `capital_raise` | News search (last 24 months) → signals `{status: possible\|likely\|confirmed_by_source, confidence, amountText, roundText, sourceIds}`; every signal `needsHumanReview: true`; signals without valid sources are dropped; report flagged `needs_review` |
| `acquisition_analysis` | Profile + similar companies + buyer candidates from acquisition news (flagged for review) |
| `similar_companies` | Exa `findSimilar` |
| `pre_call_notes` | Company/contact background, developments, acquisition interests, discussion points, questions, CRM history |
| `post_call_notes` | Summary, key points, action items (→ tasks), opportunities, follow-ups, **suggested** CRM updates (not auto-applied); logs a meeting activity |
| `buyer_classification` | Org's `buyer_bucket_rules` evaluated by the scoring service → `buyers.bucket` + explanation |

Discovery features need `EXA_API_KEY`; without it they return an explicit note rather than empty "results".

## Guardrails
- System prompt forbids guessing revenue, headcount, valuation, ownership or deal history.
- Mock LLM (no key, non-production only) builds outputs with `heuristics.ts` from retrieved text: sourced overview sentence,
  low-confidence assessments for industry/model/segments, `unknown` for positioning and revenue. Reports record `providers.mock`.
- Scoring facts are derived only from non-unknown claims (`profileToFacts`) or CRM fields (`companyRowToFacts`);
  `revenueUsd` only when `custom_fields.revenue_verified` is true.

## Enrichment workflow

```mermaid
sequenceDiagram
  participant U as User / automation
  participant API as POST /contacts/:id/enrich
  participant P as Apollo or RocketReach adapter
  participant DB as contacts / activities
  U->>API: provider? (apollo|rocketreach)
  API->>P: name, company, domain, LinkedIn URL
  alt provider configured
    P-->>API: email, provider status, title
    API->>DB: email_status = provider_verified ONLY if provider says verified/valid
  else mock
    P-->>API: found=false (never fabricated)
  end
  API->>DB: enrichment activity (provider, found, raw status)
  API-->>U: contact + enrichment summary
  Note over API: emits contact.enriched when found
```

Users can never set `provider_verified` directly; manual confirmation sets `manually_verified`.
