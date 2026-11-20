-- Tuck Advisors core schema. Every business table carries organization_id and is protected by RLS.
-- gen_random_uuid() is built into PostgreSQL 13+; no extensions required.

-- ---------------------------------------------------------------- helpers
create or replace function public.current_app_user() returns uuid language sql stable as $$
  select coalesce(auth.uid(), nullif(current_setting('app.user_id', true), '')::uuid)
$$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- identity & tenancy
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and position('@' in email) > 1),
  name text,
  password_hash text,                      -- only for local auth provider; null when Supabase Auth owns identity
  auth_provider text not null default 'local' check (auth_provider in ('local', 'supabase')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'analyst', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

-- Refresh tokens for web sessions and the Chrome extension. Only SHA-256 hashes are stored.
create table public.auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token_hash text not null unique,
  client text not null check (client in ('web', 'extension')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_tokens_user_idx on public.auth_tokens(user_id);

create or replace function public.is_org_member(org uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.organization_id = org and m.user_id = public.current_app_user())
$$;

create or replace function public.has_org_role(org uuid, roles text[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.organization_id = org and m.user_id = public.current_app_user() and m.role = any(roles))
$$;

-- ---------------------------------------------------------------- CRM
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  normalized_name text not null,
  domain text,
  website text,
  linkedin_url text,
  industry text,
  kind text not null default 'prospect' check (kind in ('prospect', 'buyer', 'target', 'client', 'other')),
  headquarters text,
  employee_range text,
  description text,
  tags text[] not null default '{}',
  custom_fields jsonb not null default '{}'::jsonb,
  linkedin_verification text not null default 'unverified' check (linkedin_verification in ('unverified', 'manually_verified', 'mismatch')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index companies_org_domain_uq on public.companies(organization_id, domain) where domain is not null and deleted_at is null;
create index companies_org_name_idx on public.companies(organization_id, normalized_name);
create index companies_org_kind_idx on public.companies(organization_id, kind) where deleted_at is null;
create index companies_tags_idx on public.companies using gin(tags);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  first_name text not null,
  last_name text,
  email text check (email is null or email = lower(email)),
  email_status text not null default 'unverified' check (email_status in ('unverified', 'provider_verified', 'manually_verified', 'invalid')),
  email_source text,
  title text,
  phone text,
  linkedin_url text,
  linkedin_verification text not null default 'unverified' check (linkedin_verification in ('unverified', 'manually_verified', 'mismatch')),
  tags text[] not null default '{}',
  source text not null default 'manual',
  custom_fields jsonb not null default '{}'::jsonb,
  enriched_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index contacts_org_email_uq on public.contacts(organization_id, email) where email is not null and deleted_at is null;
create index contacts_org_company_idx on public.contacts(organization_id, company_id);
create index contacts_linkedin_idx on public.contacts(organization_id, linkedin_url);

create table public.buyers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  buyer_type text not null default 'strategic' check (buyer_type in ('strategic', 'financial', 'family_office', 'individual', 'unknown')),
  bucket text,
  bucket_explanation jsonb not null default '[]'::jsonb,
  acquisition_criteria jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, company_id)
);

create table public.acquisition_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'identified' check (status in ('identified', 'researching', 'contacted', 'engaged', 'passed')),
  source text not null default 'manual',
  thesis text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, company_id)
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  company_id uuid references public.companies(id) on delete set null,
  source text not null,                       -- reddit, analyzer_lead, referral, manual, linkedin...
  source_url text,
  summary text,
  signals jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new', 'reviewing', 'converted', 'dismissed')),
  retrieved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index opportunities_org_source_url_uq on public.opportunities(organization_id, source_url) where source_url is not null;

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  target_company_id uuid references public.companies(id) on delete set null,
  buyer_company_id uuid references public.companies(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  side text not null default 'sell_side' check (side in ('buy_side', 'sell_side')),
  stage text not null default 'sourced' check (stage in ('sourced', 'qualified', 'engaged', 'nda', 'diligence', 'loi', 'closing', 'won', 'lost')),
  estimated_value_usd numeric(16, 2) check (estimated_value_usd is null or estimated_value_usd >= 0),
  owner_user_id uuid references public.users(id),
  notes text,
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deals_org_stage_idx on public.deals(organization_id, stage);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null check (type in ('note', 'email', 'call', 'meeting', 'research', 'stage_change', 'enrichment', 'outreach', 'system', 'comment')),
  subject text not null,
  body text,
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  actor_user_id uuid references public.users(id),
  external_ref text,                          -- e.g. gmail thread id; used to prevent duplicate logging
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index activities_org_time_idx on public.activities(organization_id, occurred_at desc);
create index activities_company_idx on public.activities(company_id, occurred_at desc);
create index activities_contact_idx on public.activities(contact_id, occurred_at desc);
create unique index activities_external_ref_uq on public.activities(organization_id, type, external_ref) where external_ref is not null;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  due_at timestamptz,
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  assignee_user_id uuid references public.users(id),
  created_by uuid references public.users(id),
  source text not null default 'manual',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_org_due_idx on public.tasks(organization_id, status, due_at);

-- ---------------------------------------------------------------- research & AI
create table public.research_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input jsonb not null default '{}'::jsonb,
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  attempts int not null default 0,
  last_error text,
  report_id uuid,
  requested_by uuid references public.users(id),
  run_after timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index research_jobs_queue_idx on public.research_jobs(status, run_after);
create index research_jobs_org_idx on public.research_jobs(organization_id, created_at desc);

create table public.research_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  title text not null,
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  content jsonb not null,                     -- validated structured output (claims with provenance)
  sources jsonb not null default '[]'::jsonb, -- [{id,url,title,provider,retrievedAt,excerpt}]
  providers jsonb not null default '{}'::jsonb,
  needs_review boolean not null default false,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index research_reports_company_idx on public.research_reports(organization_id, company_id, created_at desc);
alter table public.research_jobs add constraint research_jobs_report_fk foreign key (report_id) references public.research_reports(id) on delete set null;

-- Public analyzer results. organization_id = the firm that owns the public site.
create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_url text not null,
  buyer_url text not null,
  report jsonb not null,
  fit_score numeric(5, 2),
  requester_email text,
  consent_at timestamptz not null,
  expires_at timestamptz not null default now() + interval '180 days',
  created_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  email text not null,
  company text,
  interest text not null check (interest in ('sell_side', 'buy_side', 'analyzer', 'general')),
  message text,
  analysis_id uuid references public.ai_analyses(id) on delete set null,
  consent_at timestamptz not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'archived')),
  created_at timestamptz not null default now()
);

create table public.matrix_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  version int not null check (version > 0),
  name text not null,
  definition jsonb not null,
  is_active boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, key, version)
);
create unique index matrix_models_one_active on public.matrix_models(organization_id, key) where is_active;

create table public.fit_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  matrix_model_id uuid not null references public.matrix_models(id),
  buyer_company_id uuid not null references public.companies(id) on delete cascade,
  target_company_id uuid not null references public.companies(id) on delete cascade,
  score numeric(5, 2),
  grade text not null,
  confidence numeric(4, 3) not null,
  result jsonb not null,
  synced_to_crm_at timestamptz,
  created_at timestamptz not null default now()
);
create index fit_scores_pair_idx on public.fit_scores(organization_id, buyer_company_id, target_company_id, created_at desc);

create table public.buyer_bucket_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket text not null,
  priority int not null default 100,
  rule jsonb not null,                        -- {field, operator, values}[] all must match
  description text,
  created_at timestamptz not null default now()
);

create table public.reddit_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  post_id text not null,
  subreddit text not null,
  title text not null,
  url text not null,
  author text,
  excerpt text,
  signal_types text[] not null default '{}',
  score numeric(4, 3) not null default 0,
  posted_at timestamptz,
  retrieved_at timestamptz not null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, post_id)
);

-- ---------------------------------------------------------------- outreach & newsletters
create table public.suppression_list (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email)),
  reason text not null check (reason in ('unsubscribe', 'bounce', 'complaint', 'manual')),
  created_at timestamptz not null default now(),
  primary key (organization_id, email)
);

create table public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'scheduled', 'sending', 'paused', 'completed', 'cancelled')),
  subject_template text not null,
  body_template text not null,
  segment jsonb not null default '{}'::jsonb,
  daily_send_limit int not null default 50 check (daily_send_limit between 1 and 500),
  from_name text not null,
  from_email text not null,
  scheduled_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_approval_required check (status not in ('approved', 'scheduled', 'sending', 'completed') or approved_by is not null)
);

create table public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'queued', 'sent', 'delivered', 'bounced', 'replied', 'suppressed', 'failed')),
  provider_message_id text,
  error text,
  sent_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
create index outreach_messages_status_idx on public.outreach_messages(organization_id, status);
create index outreach_messages_provider_idx on public.outreach_messages(provider_message_id);

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email)),
  name text,
  status text not null default 'pending' check (status in ('pending', 'subscribed', 'unsubscribed')),
  consent_at timestamptz,
  unsubscribe_token text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table public.newsletters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  subject text not null,
  body_markdown text not null default '',
  research_notes jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'scheduled', 'sent')),
  scheduled_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  sent_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint newsletter_approval_required check (status not in ('approved', 'scheduled', 'sent') or approved_by is not null)
);

create table public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- automation
create table public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  trigger_type text not null,
  definition jsonb not null,
  status text not null default 'active' check (status in ('active', 'paused', 'disabled')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automations_trigger_idx on public.automations(organization_id, trigger_type) where status = 'active';

create table public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null,
  dedupe_key text,
  status text not null default 'pending' check (status in ('pending', 'running', 'waiting', 'awaiting_approval', 'succeeded', 'failed', 'skipped', 'cancelled')),
  current_step int not null default 0,
  attempts int not null default 0,
  steps jsonb not null default '[]'::jsonb,
  error text,
  resume_at timestamptz,
  approved_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index automation_exec_dedupe_uq on public.automation_executions(automation_id, dedupe_key) where dedupe_key is not null;
create index automation_exec_queue_idx on public.automation_executions(status, resume_at);
create index automation_exec_org_idx on public.automation_executions(organization_id, created_at desc);

-- ---------------------------------------------------------------- integrations
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error', 'mock')),
  config jsonb not null default '{}'::jsonb,       -- non-secret settings only
  secret_ciphertext text,                          -- AES-256-GCM, key from INTEGRATION_ENCRYPTION_KEY, never sent to clients
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table public.external_crm_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  entity_type text not null check (entity_type in ('company', 'contact', 'deal', 'fit_score')),
  local_id uuid not null,
  external_id text not null,
  last_synced_at timestamptz not null default now(),
  sync_hash text,
  unique (organization_id, provider, entity_type, local_id),
  unique (organization_id, provider, entity_type, external_id)
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

-- ---------------------------------------------------------------- audit
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid,
  actor_user_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  changes jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_time_idx on public.audit_logs(organization_id, created_at desc);

create or replace function public.audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  old_rec jsonb;
  diff jsonb;
begin
  if tg_op = 'DELETE' then rec := to_jsonb(old); else rec := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    old_rec := to_jsonb(old);
    select coalesce(jsonb_object_agg(key, jsonb_build_object('from', old_rec -> key, 'to', value)), '{}'::jsonb)
      into diff from jsonb_each(rec) where key not in ('updated_at') and rec -> key is distinct from old_rec -> key;
    if diff = '{}'::jsonb then return new; end if;
  elsif tg_op = 'INSERT' then
    diff := rec - 'password_hash' - 'secret_ciphertext';
  else
    diff := null;
  end if;
  insert into public.audit_logs(organization_id, actor_user_id, action, table_name, record_id, changes)
  values ((rec ->> 'organization_id')::uuid, public.current_app_user(), lower(tg_op), tg_table_name, rec ->> 'id', diff);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['companies','contacts','buyers','acquisition_targets','opportunities','deals','tasks','memberships',
                           'outreach_campaigns','newsletters','automations','integrations','matrix_models','leads'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
  foreach t in array array['organizations','users','companies','contacts','buyers','acquisition_targets','opportunities','deals','tasks',
                           'outreach_campaigns','outreach_messages','newsletters','automations','automation_executions','integrations'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;
