-- Sermon SEO pipeline.
-- Pulls the latest YouTube service video, transcribes it (channel captions),
-- segments it with Claude, and publishes a chaptered transcript to ms.church.
--   public.sermons              = working copy + published record (one row per video)
--   public.sermon_pipeline_runs = per-run monitor surface (the CRM "Sermons" tab)
-- Mirrors the events two-way model (see 0028_events): RLS default-deny with the
-- app.is_staff()/app.is_admin() helpers, app.set_updated_at() trigger, status
-- state machine. The pipeline itself writes via the service-role client (bypasses
-- RLS); these policies gate the operator UI reads/writes. Public site reads only
-- status='published' rows through a server endpoint, never anon RLS.

create table if not exists public.sermons (
  id uuid primary key default gen_random_uuid(),
  youtube_video_id text not null unique,
  slug text unique,
  title text not null,
  published_at timestamptz,
  thumbnail_url text,
  duration_sec integer,
  summary text,
  transcript text,
  segments jsonb not null default '[]'::jsonb,
  seo jsonb,
  status text not null default 'detected'
    check (status in ('detected','transcribing','transcribed','segmenting','segmented','review','published','failed','skipped')),
  source text not null default 'youtube' check (source in ('youtube','manual')),
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sermons_status_idx on public.sermons (status, published_at desc);
create index if not exists sermons_published_at_idx on public.sermons (published_at desc);

alter table public.sermons enable row level security;

create policy sermons_staff_read on public.sermons
  for select to authenticated using (app.is_staff());
create policy sermons_staff_insert on public.sermons
  for insert to authenticated with check (app.is_staff());
create policy sermons_staff_update on public.sermons
  for update to authenticated using (app.is_staff()) with check (app.is_staff());
create policy sermons_admin_delete on public.sermons
  for delete to authenticated using (app.is_admin());

create trigger sermons_updated_at
  before update on public.sermons
  for each row execute function app.set_updated_at();


create table if not exists public.sermon_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  sermon_id uuid references public.sermons(id) on delete set null,
  youtube_video_id text not null,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  trigger text not null default 'cron' check (trigger in ('cron','manual','backfill')),
  steps jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sermon_runs_started_idx on public.sermon_pipeline_runs (started_at desc);
create index if not exists sermon_runs_status_idx on public.sermon_pipeline_runs (status, started_at desc);
create index if not exists sermon_runs_sermon_idx on public.sermon_pipeline_runs (sermon_id);

alter table public.sermon_pipeline_runs enable row level security;

create policy sermon_runs_staff_read on public.sermon_pipeline_runs
  for select to authenticated using (app.is_staff());
create policy sermon_runs_staff_insert on public.sermon_pipeline_runs
  for insert to authenticated with check (app.is_staff());
create policy sermon_runs_staff_update on public.sermon_pipeline_runs
  for update to authenticated using (app.is_staff()) with check (app.is_staff());
create policy sermon_runs_admin_delete on public.sermon_pipeline_runs
  for delete to authenticated using (app.is_admin());

create trigger sermon_runs_updated_at
  before update on public.sermon_pipeline_runs
  for each row execute function app.set_updated_at();
