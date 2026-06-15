-- 0034_campaign_worker_cron.sql
-- Run the campaign worker from Supabase pg_cron too, so SMS/email campaigns
-- advance past the first (synchronous) batch WITHOUT GitHub Actions. The repo has
-- no Actions secrets, so that workflow's guard skipped every tick — campaigns
-- over ~one batch, and email blasts whose Brevo import isn't instant, would stall.
--
-- Same pattern as 0033's Gmail job: ping /api/cron/send-campaign-batch every
-- minute with the CRON_SECRET bearer, reading the app URL + secret from Supabase
-- Vault (shared with 0033 — add them once). The endpoint is bounded + idempotent
-- (atomic claim_campaign_batch), so re-firing is safe; an idle tick (no 'sending'
-- campaigns) is a cheap near-no-op.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'campaign-worker-poll') then
    perform cron.unschedule('campaign-worker-poll');
  end if;
end $$;

select cron.schedule(
  'campaign-worker-poll',
  '* * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/send-campaign-batch',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $job$
);
