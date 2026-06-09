-- 0031_campaign_claim_reclaim.sql
-- claim_campaign_batch flips recipients to 'sending', but only 'queued' rows
-- were ever claimable. If a worker died mid-batch (crash, or the cron route
-- hitting its maxDuration), those rows stayed 'sending' forever — never
-- re-claimed, and the campaign never finalized because finalization counts
-- 'sending' as in-flight work.
--
-- Fix: stamp claims with claimed_at, and let the claim also pick up 'sending'
-- rows whose claim has gone stale (10 minutes — far longer than any batch
-- lives). Tradeoff made explicitly: a recipient whose send reached Twilio but
-- whose outcome write was lost may be sent to twice after a crash
-- (at-least-once), which beats a permanently wedged campaign (never).

alter table public.campaign_recipients
  add column if not exists claimed_at timestamptz;

comment on column public.campaign_recipients.claimed_at is
  'When a worker claimed this row (status → sending). Stale claims (>10 min) are re-claimable.';

-- ACLs are preserved by CREATE OR REPLACE (service_role execute, set in 0006).
create or replace function public.claim_campaign_batch(
  p_campaign_id uuid,
  p_batch_size int
) returns table (contact_id uuid)
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    select campaign_id, contact_id
    from public.campaign_recipients
    where campaign_id = p_campaign_id
      and (
        status = 'queued'
        -- Stale claim from a dead worker; coalesce covers pre-0031 rows that
        -- were stuck in 'sending' with no timestamp at all.
        or (status = 'sending'
            and coalesce(claimed_at, '-infinity'::timestamptz)
                < now() - interval '10 minutes')
      )
    order by sent_at nulls first
    limit p_batch_size
    for update skip locked
  )
  update public.campaign_recipients r
    set status = 'sending',
        claimed_at = now()
    from claimed
    where r.campaign_id = claimed.campaign_id
      and r.contact_id = claimed.contact_id
    returning r.contact_id;
$$;
