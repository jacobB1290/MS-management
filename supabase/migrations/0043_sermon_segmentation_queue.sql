-- 0043_sermon_segmentation_queue.sql
-- "Claude Code as the model", wired as a proper handoff queue (CLAUDE.md §13.3).
--
-- The CRM owns everything around the model call: detect → transcribe (clean,
-- per-cue YouTube caption timestamps) → assemble the EXACT prompt from
-- src/server/ai/segmentContract → and, after the session returns raw JSON,
-- finalize (the same boundary-repair the API path runs) → write the sermon →
-- land at 'review'. The only thing handed out is the model step: a Claude Code
-- session reads a job, returns the raw segmentation JSON, and hands it back.
--
-- Why a queue and not me (the earlier ad-hoc session runs): those re-derived the
-- transcript with yt-dlp + a lossy VTT parse that collapsed YouTube's rolling
-- word-level cues into one coarse [m:ss] per block, so chapter/song boundaries
-- drifted. Feeding the session the CRM's own `timestamped` transcript removes
-- that entire failure mode — same transcript the live API path uses.
--
-- Flow + statuses:
--   pipeline (mode 'session') enqueues  -> status 'pending', sermon 'awaiting_segmentation'
--   session claims                       -> 'claimed'
--   session writes raw JSON, hands back  -> 'returned'
--   finalize cron applies + writes sermon-> 'finalized', sermon 'review'
--   anything unparseable                 -> 'error' (surfaced, sermon left as-is)
--
-- RLS default-deny: only the service-role (CRM server endpoints, the finalize
-- cron, and the Supabase MCP the session uses) touches this table — exactly like
-- sermon_backfill_queue (0039). No anon/auth policies.

-- 0) Per-run choice on the back-catalog picker: "Hold for Claude Code". When a
--    selected video is enqueued with this set, the pipeline prepares it (detect +
--    transcribe + assemble prompt) and parks a segmentation_job for a session to
--    run, instead of calling the metered Anthropic API. Default false = the
--    standard API path, unchanged.
alter table public.sermon_backfill_queue
  add column if not exists hold_for_claude boolean not null default false;

-- 1) New sermon status: parked between transcribe and the session's segmentation.
alter table public.sermons drop constraint if exists sermons_status_check;
alter table public.sermons add constraint sermons_status_check
  check (status in (
    'detected','transcribing','transcribed','segmenting',
    'awaiting_segmentation',
    'segmented','review','published','failed','skipped'
  ));

-- 2) The handoff bus. Carries the COMPLETE prompt the session needs (so the
--    session does zero setup) plus everything the finalize step needs.
create table if not exists public.segmentation_jobs (
  id              uuid primary key default gen_random_uuid(),
  sermon_id       uuid not null references public.sermons (id) on delete cascade,
  run_id          uuid references public.sermon_pipeline_runs (id) on delete set null,
  youtube_video_id text not null,
  status          text not null default 'pending'
                    check (status in ('pending','claimed','returned','finalized','error')),
  -- The exact prompt, assembled by the CRM from segmentContract at enqueue time.
  -- The session reads these verbatim and produces JSON matching json_schema.
  system_prompt   text not null,
  user_content    text not null,   -- includes the timestamped transcript
  json_schema     jsonb not null,
  duration_sec    int  not null,   -- finalize clamps/repairs boundaries against this
  known_topics    text[] not null default '{}',
  -- The session's raw model output (snake_case, matches json_schema). The CRM
  -- runs finalizeSegmentation(result, duration_sec) on it — identical to the API.
  result          jsonb,
  error           text,
  attempts        int  not null default 0,
  claimed_by      text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  returned_at     timestamptz,
  finalized_at    timestamptz
);

-- The session always grabs the oldest pending job; the finalize cron always
-- scans 'returned'. Keep both lookups cheap with partial indexes.
create index if not exists segmentation_jobs_pending_idx
  on public.segmentation_jobs (created_at) where status = 'pending';
create index if not exists segmentation_jobs_returned_idx
  on public.segmentation_jobs (returned_at) where status = 'returned';
create index if not exists segmentation_jobs_sermon_idx
  on public.segmentation_jobs (sermon_id);

alter table public.segmentation_jobs enable row level security;

-- 3) pg_cron finalize drain: every 2 minutes, hit the finalize endpoint. It
--    applies every 'returned' job (finalize + write sermon -> review), so a
--    service goes live-ready within ~2 min of the session handing it back, with
--    NO CRM instance open. CRON_SECRET-gated, reusing the same Vault secrets as
--    0037/0039 (app_base_url, cron_secret). Endpoint: /api/cron/segment-finalize.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'segment-finalize-drain') then
    perform cron.unschedule('segment-finalize-drain');
  end if;
end $$;

select cron.schedule(
  'segment-finalize-drain',
  '*/2 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/segment-finalize',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 120000
  );
  $job$
);
