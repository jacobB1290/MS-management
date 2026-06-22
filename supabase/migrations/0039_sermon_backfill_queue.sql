-- 0039_sermon_backfill_queue.sql
-- Back-catalog backfill for the /watch library. Staff select past service videos
-- in the CRM; each is enqueued here and a Supabase pg_cron worker drains the
-- queue SERVER-SIDE, so years of services process autonomously with NO CRM
-- instance open. Each item runs the same sermon pipeline (transcribe -> segment)
-- and lands at status 'review' for a human to bulk-publish — we never auto-publish
-- AI output to the live site.
--
-- The worker claims one item per tick with an optimistic `status = 'pending'`
-- guard (no row locks needed): if two ticks ever overlap, only one UPDATE flips
-- the row to 'running'; the other matches 0 rows and moves on.

create table if not exists public.sermon_backfill_queue (
  youtube_video_id text primary key,
  title            text,
  published_at     timestamptz,
  status           text not null default 'pending'
                     check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  attempts         int  not null default 0,
  error            text,
  requested_by     uuid references auth.users (id) on delete set null,
  requested_at     timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);

-- The worker always grabs the oldest pending item; keep that lookup cheap.
create index if not exists sermon_backfill_pending_idx
  on public.sermon_backfill_queue (requested_at)
  where status = 'pending';

-- RLS default-deny: only the service-role (server endpoints + the cron worker)
-- touches this table, exactly like the rest of the sermon pipeline. No anon/auth
-- policies, so the publishable key can never read or write it.
alter table public.sermon_backfill_queue enable row level security;

-- pg_cron worker: every 5 minutes, hit the drain endpoint. It claims and runs ONE
-- item per call (segmenting is minutes-long), so frequent ticks chew through the
-- catalog over time. CRON_SECRET-gated, reusing the same Vault secrets as 0037
-- (app_base_url, cron_secret). Endpoint: /api/cron/sermon-backfill.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sermon-backfill-drain') then
    perform cron.unschedule('sermon-backfill-drain');
  end if;
end $$;

select cron.schedule(
  'sermon-backfill-drain',
  '*/5 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/sermon-backfill',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 290000
  );
  $job$
);
