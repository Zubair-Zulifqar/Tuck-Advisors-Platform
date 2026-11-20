-- The application connects as the migration user and switches to `authenticated` per request
-- (SET LOCAL ROLE in withOrg) so RLS applies. Grant membership so that switch is allowed on
-- plain PostgreSQL / Cloud SQL. On Supabase this is already true and the grant is a no-op.
do $$
begin
  if not pg_has_role(current_user, 'authenticated', 'member') then
    execute format('grant authenticated to %I', current_user);
  end if;
end $$;
