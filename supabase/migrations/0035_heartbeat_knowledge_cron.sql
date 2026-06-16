-- 0035_heartbeat_knowledge_cron.sql
-- Move the last two scheduled jobs off GitHub Actions onto Supabase pg_cron, so
-- the whole cron surface lives in one place (joining 0033's Gmail mirror and
-- 0034's campaign worker). The repo has NO Actions secrets, so both GH workflows'
-- guards skipped every tick: the DB keep-warm ping never ran and the AI knowledge
-- base went stale. This deletes that dependency.
--
--   * heartbeat        -> internal UPDATE (no HTTP). It only needs to bump the
--                         singleton row's last_run_at (the Settings "Last run"
--                         card + free-tier keep-warm). The DB updating its own
--                         table is strictly more reliable than an app round-trip
--                         and needs no secret; the old GH job likewise wrote
--                         straight to Supabase, never hitting the app.
--   * knowledge-sync   -> http_get to /api/cron/sync-knowledge. This one is real
--                         app logic (fetches ms.church + refreshes the AI facts),
--                         so it must hit Vercel, same bearer pattern as 0033/0034.
--
-- Secrets are NOT hardcoded (this file is committed). The knowledge job reads the
-- app URL + CRON_SECRET from Supabase Vault — the SAME two secrets 0033/0034
-- already use, so there is nothing new to add. CRON_SECRET must be on the Vercel
-- PRODUCTION scope so the endpoint accepts the call (it already is).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Heartbeat: bump the singleton row daily. Idempotent (re)schedule.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'heartbeat-keepalive') then
    perform cron.unschedule('heartbeat-keepalive');
  end if;
end $$;

select cron.schedule(
  'heartbeat-keepalive',
  '0 9 * * *',
  $job$ update public.heartbeat set last_run_at = now() where id = 1; $job$
);

-- Knowledge sync: ping the app endpoint daily (bearer CRON_SECRET from Vault).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'knowledge-sync-poll') then
    perform cron.unschedule('knowledge-sync-poll');
  end if;
end $$;

select cron.schedule(
  'knowledge-sync-poll',
  '30 9 * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/sync-knowledge',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $job$
);
