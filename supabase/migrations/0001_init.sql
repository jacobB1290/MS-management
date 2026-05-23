-- 0001_init.sql
-- Initial schema for the CRM + comms engine.
-- Core entities: app_users, contacts, messages, campaigns, campaign_recipients,
-- email_events, form_submissions, audit_log, heartbeat.
-- Default-deny RLS on every table; staff role gating via app.* helpers.

-- Extensions -----------------------------------------------------------------
create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

-- App helpers schema ---------------------------------------------------------
create schema if not exists app;

-- app_users: maps auth.users to a role ---------------------------------------
create table public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Role helpers (SECURITY DEFINER so they read app_users regardless of RLS) ---
create or replace function app.current_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.app_users where user_id = auth.uid();
$$;

create or replace function app.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_users
    where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function app.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_users
    where user_id = auth.uid() and role in ('admin', 'member')
  );
$$;

-- updated_at trigger helper --------------------------------------------------
create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger app_users_updated_at before update on public.app_users
  for each row execute function app.set_updated_at();

-- contacts -------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text unique check (phone is null or phone ~ '^\+[1-9]\d{1,14}$'),
  email citext,
  source text,
  tags text[] not null default '{}',
  language text not null default 'en' check (language in ('en', 'ru')),
  -- Single source of truth for opt-out state: NULL means opted in.
  sms_opted_out_at timestamptz,
  email_unsubscribed_at timestamptz,
  -- 10DLC/TCPA audit trail. Required when send is possible.
  consent_method text,
  consent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_tags_gin on public.contacts using gin (tags);
create index contacts_email_idx on public.contacts (email) where email is not null;
create index contacts_name_trgm on public.contacts using gin (name gin_trgm_ops);
create index contacts_created_at on public.contacts (created_at desc);

create trigger contacts_updated_at before update on public.contacts
  for each row execute function app.set_updated_at();

-- campaigns ------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null check (channel in ('sms', 'email')),
  body text,
  sendgrid_template_id text,
  email_subject text,
  audience_filter jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'done', 'failed', 'cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_payload_required check (
    (channel = 'sms' and body is not null) or
    (channel = 'email' and sendgrid_template_id is not null)
  )
);

create index campaigns_status_idx on public.campaigns (status, scheduled_at);

create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function app.set_updated_at();

-- messages -------------------------------------------------------------------
-- The conversation history. A thread is WHERE contact_id = X ORDER BY created_at.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  body text,
  media_url text,
  channel text not null check (channel in ('sms', 'mms')),
  -- Idempotency: webhook retries cannot create duplicates.
  twilio_sid text unique,
  status text,
  error text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index messages_contact_created on public.messages (contact_id, created_at desc);
create index messages_campaign on public.messages (campaign_id) where campaign_id is not null;
create index messages_status on public.messages (status);

-- campaign_recipients (also the send queue) ----------------------------------
create table public.campaign_recipients (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null default 'queued' check (status in (
    'queued', 'sending', 'sent', 'delivered', 'failed',
    'skipped_opt_out', 'skipped_unsubscribed', 'skipped_no_channel'
  )),
  provider_id text,
  error text,
  sent_at timestamptz,
  primary key (campaign_id, contact_id)
);

create index campaign_recipients_status on public.campaign_recipients (campaign_id, status);

-- email_events ---------------------------------------------------------------
create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  sendgrid_event_id text unique,
  contact_id uuid references public.contacts(id) on delete set null,
  email citext,
  event_type text not null,
  payload jsonb,
  occurred_at timestamptz not null default now()
);

create index email_events_contact on public.email_events (contact_id, occurred_at desc);
create index email_events_email on public.email_events (email, occurred_at desc);
create index email_events_type on public.email_events (event_type, occurred_at desc);

-- Auto-sync unsubscribe back to contacts
create or replace function app.sync_email_unsubscribe()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.event_type in ('unsubscribe', 'spamreport', 'group_unsubscribe', 'dropped') then
    if new.contact_id is not null then
      update public.contacts
        set email_unsubscribed_at = coalesce(email_unsubscribed_at, new.occurred_at)
        where id = new.contact_id and email_unsubscribed_at is null;
    elsif new.email is not null then
      update public.contacts
        set email_unsubscribed_at = coalesce(email_unsubscribed_at, new.occurred_at)
        where email = new.email and email_unsubscribed_at is null;
    end if;
  end if;
  return new;
end;
$$;

create trigger email_events_sync_unsubscribe
  after insert on public.email_events
  for each row execute function app.sync_email_unsubscribe();

-- form_submissions (proof-of-opt-in; immutable) ------------------------------
create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id text,
  payload jsonb not null,
  phone text,
  email citext,
  name text,
  consent_method text not null,
  consent_at timestamptz not null default now(),
  ip inet,
  user_agent text,
  contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now()
);

create index form_submissions_contact on public.form_submissions (contact_id);
create index form_submissions_created on public.form_submissions (created_at desc);

-- audit_log (write-only) -----------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_table text,
  target_id text,
  diff jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_log_actor on public.audit_log (actor_user_id, created_at desc);
create index audit_log_target on public.audit_log (target_table, target_id, created_at desc);
create index audit_log_action on public.audit_log (action, created_at desc);

-- heartbeat (keepalive ping target) ------------------------------------------
create table public.heartbeat (
  id int primary key default 1,
  last_run_at timestamptz not null default now(),
  constraint singleton check (id = 1)
);
insert into public.heartbeat (id) values (1);

-- ============================================================================
-- Row Level Security: default-deny on every table, then explicit allow policies
-- ============================================================================
alter table public.app_users enable row level security;
alter table public.contacts enable row level security;
alter table public.messages enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.email_events enable row level security;
alter table public.form_submissions enable row level security;
alter table public.audit_log enable row level security;
alter table public.heartbeat enable row level security;

-- app_users: each user can read own row; admin can read/write all rows
create policy app_users_select_self_or_admin on public.app_users
  for select to authenticated using (user_id = auth.uid() or app.is_admin());
create policy app_users_admin_write on public.app_users
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- contacts: staff read/write; admin delete
create policy contacts_staff_read on public.contacts
  for select to authenticated using (app.is_staff());
create policy contacts_staff_insert on public.contacts
  for insert to authenticated with check (app.is_staff());
create policy contacts_staff_update on public.contacts
  for update to authenticated using (app.is_staff()) with check (app.is_staff());
create policy contacts_admin_delete on public.contacts
  for delete to authenticated using (app.is_admin());

-- messages: staff read only; all writes happen server-side via service_role
create policy messages_staff_read on public.messages
  for select to authenticated using (app.is_staff());

-- campaigns: staff read/write; admin delete
create policy campaigns_staff_read on public.campaigns
  for select to authenticated using (app.is_staff());
create policy campaigns_staff_insert on public.campaigns
  for insert to authenticated with check (app.is_staff());
create policy campaigns_staff_update on public.campaigns
  for update to authenticated using (app.is_staff()) with check (app.is_staff());
create policy campaigns_admin_delete on public.campaigns
  for delete to authenticated using (app.is_admin());

-- campaign_recipients: staff read; writes via service_role
create policy campaign_recipients_staff_read on public.campaign_recipients
  for select to authenticated using (app.is_staff());

-- email_events: staff read; writes via service_role
create policy email_events_staff_read on public.email_events
  for select to authenticated using (app.is_staff());

-- form_submissions: admin read; writes via service_role
create policy form_submissions_admin_read on public.form_submissions
  for select to authenticated using (app.is_admin());

-- audit_log: admin read; writes via service_role; never updated or deleted
create policy audit_log_admin_read on public.audit_log
  for select to authenticated using (app.is_admin());

-- heartbeat: staff read
create policy heartbeat_staff_read on public.heartbeat
  for select to authenticated using (app.is_staff());

-- ============================================================================
-- Realtime: stream messages + campaign progress to the operator UI
-- ============================================================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.campaign_recipients;
alter publication supabase_realtime add table public.contacts;

-- ============================================================================
-- Convenience view: contacts with computed flags for the inbox sidebar
-- ============================================================================
create or replace view public.contact_summary
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.phone,
  c.email,
  c.tags,
  c.language,
  c.sms_opted_out_at,
  c.email_unsubscribed_at,
  c.created_at,
  (select max(m.created_at) from public.messages m where m.contact_id = c.id) as last_message_at,
  (select count(*) from public.messages m where m.contact_id = c.id) as message_count
from public.contacts c;
