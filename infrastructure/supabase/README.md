# Supabase

Migrations live in [`supabase/migrations`](../../supabase/migrations) (forward-only, timestamped).

```bash
supabase link --project-ref <ref>
supabase db push                 # applies supabase/migrations to the linked project
# or, without the CLI:
DATABASE_URL=<supabase direct connection string> npm run db:migrate
```

- **RLS** is enabled on every business table; policies call `public.is_org_member()` / `public.has_org_role()`.
  On Supabase, `auth.uid()` is the native function; the compat migration leaves it untouched.
- **Auth.** Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Users whose `public.users.auth_provider`
  is `supabase` are verified against Supabase Auth (`/auth/v1/token?grant_type=password`); the app then issues its own
  signed session. Provision each staff member with a `public.users` row (same id as `auth.users`) and a `memberships` row.
- **Service-role key** is never required by the web app or extension; the server connects with `DATABASE_URL`.
- **Storage** is not used yet (no file uploads are implemented).
