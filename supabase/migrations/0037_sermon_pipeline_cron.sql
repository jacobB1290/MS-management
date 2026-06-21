-- 0037_sermon_pipeline_cron.sql
-- Drive the sermon pipeline from Supabase pg_cron, once a week. It detects the
-- newest service video, pulls its YouTube captions, and segments the transcript
-- with Claude, leaving the result at status 'review' for a human to publish.
--
-- Schedule: Monday 18:00 UTC (~11am-12pm America/Boise) — well after the Sunday
-- service + enough lead time for YouTube auto-captions to finish generating.
-- The run is idempotent: a video that's already processed is a clean no-op, so
-- the weekly tick is safe, and staff can also "Run now" from the CRM if captions
-- were late. Endpoint: /api/cron/sermon-pipeline (CRON_SECRET-gated).
--
-- Secrets are NOT hardcoded (this file is committed). Reuses the same Vault
-- secrets the Gmail + campaign crons already use (see 0033/0034):
--   select vault.create_secret('https://<prod-host>', 'app_base_url');  -- once
--   select vault.create_secret('<CRON_SECRET>',       'cron_secret');   -- once
-- CRON_SECRET must also be on the Vercel PRODUCTION scope so the endpoint accepts it.
--
-- Until the YouTube caption OAuth scope is configured (see
-- docs/sermons-youtube-setup-runbook.md) the weekly run will record a single
-- FAILED row on sermon_pipeline_runs at the transcribe step — that is expected
-- and is exactly what the CRM "Sermons" monitor surfaces; it self-heals the
-- first Monday after the token is set.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent (re)schedule: drop a prior job of the same name first.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sermon-pipeline-weekly') then
    perform cron.unschedule('sermon-pipeline-weekly');
  end if;
end $$;

select cron.schedule(
  'sermon-pipeline-weekly',
  '0 18 * * 1',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/sermon-pipeline',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 120000
  );
  $job$
);
