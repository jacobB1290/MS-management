-- Record contacts skipped from an SMS campaign because they lack express
-- marketing consent. Previously these were filtered out of the audience query
-- entirely, leaving no record of who was skipped or why. Staging them as
-- 'skipped_no_consent' rows gives a permanent, auditable account (matching the
-- existing skipped_opt_out / skipped_unsubscribed / skipped_no_channel record)
-- and powers the pre-send breakdown.
alter table public.campaign_recipients
  drop constraint if exists campaign_recipients_status_check;

alter table public.campaign_recipients
  add constraint campaign_recipients_status_check check (status in (
    'queued', 'sending', 'sent', 'delivered', 'failed',
    'skipped_opt_out', 'skipped_unsubscribed', 'skipped_no_channel', 'skipped_no_consent'
  ));
