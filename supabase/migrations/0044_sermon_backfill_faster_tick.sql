-- 0044_sermon_backfill_faster_tick.sql
-- The back-catalog drain (0039) ran one item every 5 min — tuned for the API
-- path, where each item includes a multi-minute Claude segmentation on a 300s
-- function. With the "Hold for Claude Code" path (0043) the worker now batches
-- ALL pending held items in a single tick (each only transcribes + parks a job,
-- no API call) and keeps API items strictly serial via a running-guard, so a
-- tight cadence is safe. Drop the tick to every 2 min so a held selection lands
-- in the segmentation queue within ~2 min instead of ~5 min/item.
-- Command is unchanged from 0039 (same endpoint + Vault secrets); only the
-- schedule changes.

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
  '*/2 * * * *',
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
