# Google Cloud SQL (PostgreSQL)

The schema in `supabase/migrations/` is plain PostgreSQL 15+ and runs unchanged on Cloud SQL. The
`20261120000000_auth_compat.sql` migration creates an `auth.uid()` shim and the `authenticated`/`anon`
roles when they don't exist, so the same RLS policies are enforced outside Supabase.

```bash
gcloud sql instances create tuck-pg --database-version=POSTGRES_16 --tier=db-custom-1-3840 --region=us-central1
gcloud sql databases create tuck --instance=tuck-pg
gcloud sql users create tuck_app --instance=tuck-pg --password=<generated>

# From a machine with the Cloud SQL Auth Proxy running on 127.0.0.1:5432:
DATABASE_URL=postgres://tuck_app:<password>@127.0.0.1:5432/tuck npm run db:migrate
```

Notes
- The application role must be allowed to `SET ROLE authenticated` (grant `authenticated` to `tuck_app`), because
  `withOrg()` runs every request as that role so RLS applies.
- Use `sslmode=require` in `DATABASE_URL` for public-IP connections, or private IP + Serverless VPC Access.
- The Python batch scorer reads the same `DATABASE_URL`:
  `python -m tuck_scoring.batch --org <uuid> --model-key default-ma-matrix --dry-run`.
- Nothing here is provisioned automatically; creating instances incurs cost.
