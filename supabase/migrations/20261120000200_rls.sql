-- Row-Level Security: organisation isolation. The application server ALSO filters by organization_id
-- on every query (defence in depth); these policies protect any direct Supabase client access.
do $$
declare t text;
begin
  foreach t in array array[
    'companies','contacts','buyers','acquisition_targets','opportunities','deals','activities','tasks',
    'research_jobs','research_reports','ai_analyses','leads','matrix_models','fit_scores','buyer_bucket_rules',
    'reddit_signals','suppression_list','outreach_campaigns','outreach_messages','newsletter_subscribers',
    'newsletters','communication_templates','automations','automation_executions','external_crm_mappings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))$p$, t || '_member_read', t);
    execute format($p$create policy %I on public.%I for insert to authenticated with check (public.has_org_role(organization_id, array['owner','admin','analyst']))$p$, t || '_writer_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated using (public.has_org_role(organization_id, array['owner','admin','analyst'])) with check (public.has_org_role(organization_id, array['owner','admin','analyst']))$p$, t || '_writer_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated using (public.has_org_role(organization_id, array['owner','admin']))$p$, t || '_admin_delete', t);
  end loop;
end $$;

-- Tenancy tables
alter table public.organizations enable row level security;
create policy organizations_member_read on public.organizations for select to authenticated using (public.is_org_member(id));
create policy organizations_owner_update on public.organizations for update to authenticated using (public.has_org_role(id, array['owner','admin']));

alter table public.memberships enable row level security;
create policy memberships_member_read on public.memberships for select to authenticated using (public.is_org_member(organization_id));
create policy memberships_owner_write on public.memberships for all to authenticated
  using (public.has_org_role(organization_id, array['owner'])) with check (public.has_org_role(organization_id, array['owner']));

alter table public.users enable row level security;
create policy users_self_read on public.users for select to authenticated using (
  id = public.current_app_user() or exists (
    select 1 from public.memberships a join public.memberships b on a.organization_id = b.organization_id
    where a.user_id = public.current_app_user() and b.user_id = users.id));
create policy users_self_update on public.users for update to authenticated using (id = public.current_app_user());

-- Secrets and credentials are server-only: no policies => no access for authenticated/anon.
alter table public.integrations enable row level security;
create policy integrations_admin_read on public.integrations for select to authenticated using (public.has_org_role(organization_id, array['owner','admin']));
revoke select (secret_ciphertext) on public.integrations from authenticated, anon;
alter table public.auth_tokens enable row level security;
alter table public.webhook_events enable row level security;

alter table public.audit_logs enable row level security;
create policy audit_admin_read on public.audit_logs for select to authenticated using (public.has_org_role(organization_id, array['owner','admin']));

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.auth_tokens, public.webhook_events from authenticated, anon;
revoke insert, update, delete on public.audit_logs from authenticated, anon;
