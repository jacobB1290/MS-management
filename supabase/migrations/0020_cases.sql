-- 0020_cases.sql
-- Unified intake backbone. Prayer requests and inquiries (and every future
-- intake type) collapse into one table discriminated by `type`, so a new
-- module is a new type value + a code config rather than another twin table,
-- twin RLS block, and twin reply route. Mirrors the RLS + trigger shape of
-- 0017_prayer_requests / 0018_inquiries exactly.
--
-- This migration is purely additive: nothing reads `cases` yet. The backfill
-- from the existing module tables and the server/UI cutover land in later
-- migrations so each step stays reversible.

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  -- Intake type, e.g. 'prayer' | 'question'. Validated in the typed server
  -- layer (Zod), not a DB enum, so a new type ships without a migration and
  -- per-type status sets can differ.
  type text not null,
  contact_id uuid references public.contacts(id) on delete set null,
  requester_name text,
  -- Short label / subject (was inquiries.topic); optional.
  title text,
  body text not null,
  -- Per-type lifecycle, e.g. prayer: new/praying/answered/archived;
  -- question: new/in_progress/closed. Validated in code (see caseTypes config).
  status text not null default 'new',
  assigned_to uuid references auth.users(id) on delete set null,
  -- LLM triage fields (populated best-effort; null until classified).
  -- priority: urgency score for worklist sorting (higher = sooner).
  priority smallint,
  -- summary: one-line digest for the worklist row.
  summary text,
  -- ai_meta: classification provenance (model, confidence, crisis flag, ...).
  ai_meta jsonb not null default '{}'::jsonb,
  -- details: type-specific structured fields that don't deserve a column.
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Worklist + lookup indexes.
create index if not exists cases_type_status_idx
  on public.cases (type, status, created_at desc);
create index if not exists cases_contact_idx
  on public.cases (contact_id);
-- "Needs attention" ordering: open items, most urgent first.
create index if not exists cases_open_priority_idx
  on public.cases (status, priority desc nulls last, created_at desc);

alter table public.cases enable row level security;

-- Staff manage cases; admins may delete. Outbound replies happen server-side
-- with the service-role key (bypasses RLS), gated by assertCanSendSms.
create policy cases_staff_read on public.cases
  for select to authenticated using (app.is_staff());
create policy cases_staff_insert on public.cases
  for insert to authenticated with check (app.is_staff());
create policy cases_staff_update on public.cases
  for update to authenticated using (app.is_staff()) with check (app.is_staff());
create policy cases_admin_delete on public.cases
  for delete to authenticated using (app.is_admin());

create trigger cases_updated_at
  before update on public.cases
  for each row execute function app.set_updated_at();
