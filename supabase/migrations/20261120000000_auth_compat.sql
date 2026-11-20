-- Compatibility shim so the same migrations run on hosted Supabase and on plain PostgreSQL / PGlite.
-- On Supabase the auth schema and auth.uid() already exist and are left untouched.
create schema if not exists auth;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $f$
      create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid'
    $f$;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;

-- Outside Supabase we own the auth schema and must grant the API roles access to auth.uid().
do $$
begin
  if (select nspowner = (select oid from pg_roles where rolname = current_user) from pg_namespace where nspname = 'auth') then
    grant usage on schema auth to authenticated, anon;
    grant execute on all functions in schema auth to authenticated, anon;
  end if;
end $$;
