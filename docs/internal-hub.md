# Internal operations hub

`/app/*` (server components reading via `query()` → `withOrg()`), client components call `/api/v1/*` and refresh.

| Module | Route | What it does |
| --- | --- | --- |
| Dashboard | `/app` | Counts of companies, contacts, targets, active deals, research jobs/reports, opportunities, outreach (30 d), approvals, automation runs; pipeline by stage; follow-ups; recent CRM activity; latest reports; team activity — all live SQL |
| Companies | `/app/companies`, `/app/companies/:id` | Search/filter by type/tag, pagination, create with duplicate detection (domain, normalised name, LinkedIn URL), CSV import (dry-run capable, per-row results) and export, edit, archive (soft delete), research launcher, fit scores, contacts, deals, tasks, timeline, LinkedIn verification, Pipeline CRM sync |
| Contacts | `/app/contacts`, `/app/contacts/:id` | Email verification status, enrichment, manual verification, interaction history, follow-ups, pre/post-call notes, AI email drafts |
| Pipeline | `/app/deals` | Board across 9 stages; stage changes log activities and emit `deal.stage_changed` |
| Tasks | `/app/tasks` | Open / mine / done; due-date highlighting; overdue tasks emit `task.follow_up_due` once |
| Research | `/app/research`, `/app/research/:id` | Job history with attempts/errors; report viewer with provenance badges and sources; mark reviewed; Google Docs export |
| M&A Matrix | `/app/matrix` | Edit criteria/weights/thresholds/exclusions and publish new versions; score pairs; bucket rules |
| Deal sourcing | `/app/reddit` | Reddit API search, explainable signals, save to CRM opportunities, convert to company + deal |
| Communications | `/app/communications` | Firm-wide timeline (email, call, meeting, outreach, internal comments), templates |
| Outreach | `/app/outreach`, `/app/outreach/:id` | See [bulk-outreach.md](bulk-outreach.md) |
| Newsletters | `/app/newsletters`, `/app/newsletters/:id` | Research-backed drafts, editing, submit → approve (different person) → schedule → send to consented subscribers |
| Automations | `/app/automations`, `/app/automations/:id` | See [automation-engine.md](automation-engine.md) |
| Settings | `/app/settings` | Members & roles (owner only), integration modes, audit log |

## REST API (`/api/v1`)

| Endpoint | Methods | Permission |
| --- | --- | --- |
| `/me` | GET | any member |
| `/match?domain=&linkedinUrl=&name=&emails=` | GET | crm:read |
| `/companies`, `/companies/:id` | GET, POST / GET, PATCH, DELETE | crm:read / crm:write / crm:delete |
| `/companies/import`, `/companies/export` | POST / GET | crm:write / crm:read |
| `/contacts`, `/contacts/:id`, `/contacts/:id/enrich` | … | crm:* / research:run |
| `/deals`, `/deals/:id` | GET, POST / GET, PATCH | crm:read / crm:write |
| `/activities`, `/tasks`, `/tasks/:id` | GET, POST / PATCH | crm:read / crm:write |
| `/research`, `/research/jobs/:id` | GET, POST (202) / GET | research:run / crm:read |
| `/research/reports/:id/review`, `/research/reports/:id/export` | POST | crm:write / research:run |
| `/fit-scores` | GET, POST | crm:read / research:run |
| `/matrix`, `/bucket-rules` | GET, POST (+DELETE) | crm:read / automation:manage |
| `/linkedin/verify` | POST | crm:write |
| `/automations`, `/automations/:id`, `/automations/templates`, `/automations/executions/:id` | … | automation:manage (+approve) |
| `/outreach/campaigns`, `/outreach/campaigns/:id/:action` | POST | outreach:draft (+approve) |
| `/newsletters`, `/newsletters/:id`, `/newsletters/:id/:action` | POST, PATCH | outreach:draft (+newsletter:approve) |
| `/reddit/scan`, `/reddit/signals/:id` | POST | research:run / crm:write |
| `/opportunities/:id` | POST (review/dismiss/convert) | crm:write |
| `/communications/draft`, `/templates` | POST | outreach:draft |
| `/members/:userId` | PATCH | members:manage |
| `/sync/:companyId` | POST | integrations:manage |

Responses: `{ data }` or `{ error: { message, details? } }`.
