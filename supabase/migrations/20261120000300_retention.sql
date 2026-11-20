-- Retention & deletion helpers. Run from a scheduled worker; never destructive beyond stated windows.
create or replace function public.purge_expired_data(soft_delete_days int default 30, audit_days int default 730)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_analyses int; n_companies int; n_contacts int; n_tokens int; n_audit int;
begin
  delete from public.ai_analyses where expires_at < now();
  get diagnostics n_analyses = row_count;
  delete from public.contacts where deleted_at is not null and deleted_at < now() - make_interval(days => soft_delete_days);
  get diagnostics n_contacts = row_count;
  delete from public.companies where deleted_at is not null and deleted_at < now() - make_interval(days => soft_delete_days);
  get diagnostics n_companies = row_count;
  delete from public.auth_tokens where expires_at < now() - interval '7 days' or revoked_at < now() - interval '7 days';
  get diagnostics n_tokens = row_count;
  delete from public.audit_logs where created_at < now() - make_interval(days => audit_days);
  get diagnostics n_audit = row_count;
  return jsonb_build_object('ai_analyses', n_analyses, 'contacts', n_contacts, 'companies', n_companies, 'auth_tokens', n_tokens, 'audit_logs', n_audit);
end $$;
revoke all on function public.purge_expired_data(int, int) from public, authenticated, anon;
