# Deployment

Nothing is deployed automatically. All configs below are templates; provisioning cloud resources requires explicit approval.

| Component | Target | Config |
| --- | --- | --- |
| Web app (site + hub + API) | Vercel or container | `apps/web/vercel.json`, `infrastructure/web.Dockerfile` |
| Queue worker | Container (ECS, Cloud Run, Fly, …) | `infrastructure/worker.Dockerfile` (`npx tsx apps/workers/src/index.ts`) |
| Scheduled queue pass (serverless) | Vercel Cron → `GET /api/internal/cron` every 5 min | requires `CRON_SECRET` |
| Fit Score service | Container or AWS Lambda | `services/ai-research/Dockerfile`, `infrastructure/aws/lambda/template.yaml` |
| Database | Supabase or Google Cloud SQL (PostgreSQL 15+) | `infrastructure/supabase/README.md`, `infrastructure/gcp/cloud-sql.md` |
| Chrome extension | Chrome Web Store (manual upload) | `npm run package -w @tuck/extension` → `dist/tuck-advisors-extension.zip` |

## Vercel
- Project root `apps/web`; install/build commands in `vercel.json` run from the monorepo root.
- Env: `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, `CRON_SECRET`, `EXTENSION_IDS`, `SCORING_SERVICE_URL`(+`_TOKEN`), and provider keys.
- Vercel Cron calls `/api/internal/cron`; Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when the variable is set.
- Run migrations from CI or a workstation: `DATABASE_URL=… npm run db:migrate` (or set `AUTO_MIGRATE=true` on the worker).

## Production checklist
- `NODE_ENV=production` (mock LLM/email providers refuse to start; embedded DB refused unless `ALLOW_EMBEDDED_DB=true`).
- `SESSION_SECRET` ≥ 32 random chars; `EXTENSION_IDS` set; `SCORING_SERVICE_TOKEN` set on both sides.
- DB role can `SET ROLE authenticated`.
- Webhook secrets configured before exposing webhook URLs.
- Use Redis-backed rate limiting when running multiple web instances.
- Review legal pages; verify Pipeline CRM / Apollo / RocketReach endpoints and terms.
- Chrome Web Store: set `TUCK_API_BASE_URL` to the production URL and `NODE_ENV=production` when packaging.
