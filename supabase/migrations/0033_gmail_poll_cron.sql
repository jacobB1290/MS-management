-- 0033_gmail_poll_cron.sql
-- Drive the Gmail mirror from Supabase pg_cron (every minute) instead of GitHub
-- Actions. The repo had no Actions secrets, so the GH workflow's own guard
-- (`[ -z APP_BASE_URL ] || [ -z CRON_SECRET ] -> exit 0`) skipped every tick and
-- the app was never hit. pg_cron bypasses GitHub Actions entirely.
--
-- The tick is cheap: syncGmailMailbox() is INCREMENTAL (Gmail history.list from
-- the stored cursor), so an idle minute is one tiny history call + a cursor
-- touch, never a re-scan. Endpoint: /api/cron/gmail (CRON_SECRET-gated).
--
-- Secrets are NOT hardcoded here (this file is committed). The job reads the app
-- URL and CRON_SECRET from Supabase Vault at run time. Add them ONCE (SQL editor),
-- then the job starts working:
--   select vault.create_secret('https://<prod-host>', 'app_base_url');
--   select vault.create_secret('<CRON_SECRET>',       'cron_secret');
-- CRON_SECRET must also be on the Vercel PRODUCTION scope so the endpoint accepts it.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent (re)schedule: drop a prior job of the same name first.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'gmail-mirror-poll') then
    perform cron.unschedule('gmail-mirror-poll');
  end if;
end $$;

select cron.schedule(
  'gmail-mirror-poll',
  '* * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/gmail',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $job$
);
