-- 0029_brevo_email.sql
-- Switch the email provider from SendGrid to Brevo.
--
-- Strategy is expand/contract: this migration is ADDITIVE so the currently
-- deployed (SendGrid) code keeps working until the Brevo branch ships. A later
-- migration drops the dead SendGrid columns (sendgrid_template_id,
-- sendgrid_event_id) once nothing reads them.
--
--   * contacts.brevo_contact_id   — Brevo's contact id after first sync.
--   * campaigns.brevo_template_id — Brevo template id (int) for email blasts;
--     replaces the SendGrid 'd-...' string id. The payload CHECK is widened to
--     accept EITHER during the transition.
--   * campaigns.brevo_campaign_id / brevo_list_id / brevo_sync / stats — the
--     Brevo blast handle, its synced audience list, transient dispatch
--     bookkeeping, and the cached campaign statistics.
--   * email_events.provider_event_id — Brevo emits NO per-event UUID, so the
--     webhook synthesizes a dedup key (message-id|event|ts). Kept UNIQUE for
--     ON CONFLICT DO NOTHING idempotency, mirroring sendgrid_event_id.
--   * the unsubscribe-sync trigger learns Brevo's event vocabulary
--     ('spam', 'hard_bounce') on top of the SendGrid set.

-- contacts -------------------------------------------------------------------
alter table public.contacts
  add column if not exists brevo_contact_id text;

comment on column public.contacts.brevo_contact_id is
  'Brevo contact id (integer as text) after first sync; NULL = never synced. Opt-out stays email_unsubscribed_at (Brevo emailBlacklisted mirrors to it via webhook).';

-- campaigns ------------------------------------------------------------------
alter table public.campaigns
  add column if not exists brevo_template_id integer,
  add column if not exists brevo_campaign_id bigint,
  add column if not exists brevo_list_id bigint,
  add column if not exists brevo_sync jsonb,
  add column if not exists stats jsonb;

comment on column public.campaigns.brevo_template_id is
  'Brevo email template id (integer). Required for channel=email under Brevo.';
comment on column public.campaigns.brevo_campaign_id is
  'Brevo emailCampaigns id once the blast is created. NULL until dispatched.';
comment on column public.campaigns.brevo_list_id is
  'Brevo list id holding the consent-cleared audience synced for this blast.';
comment on column public.campaigns.brevo_sync is
  'Transient dispatch bookkeeping (e.g. {import_process_id, phase}). Cleared once sent.';
comment on column public.campaigns.stats is
  'Cached Brevo campaign statistics.globalStats (sent/delivered/opens/...).';

-- Widen the payload CHECK so BOTH SendGrid (old code) and Brevo (new code) can
-- create email campaigns during the transition. The Brevo send path requires
-- brevo_template_id at the application layer.
alter table public.campaigns
  drop constraint if exists campaign_payload_required;
alter table public.campaigns
  add constraint campaign_payload_required check (
    (channel = 'sms' and body is not null) or
    (channel = 'email' and (brevo_template_id is not null or sendgrid_template_id is not null))
  );

-- email_events ---------------------------------------------------------------
alter table public.email_events
  add column if not exists provider_event_id text;

create unique index if not exists email_events_provider_event_id_key
  on public.email_events (provider_event_id)
  where provider_event_id is not null;

comment on column public.email_events.provider_event_id is
  'Synthesized Brevo dedup key (message-id|event|ts_event) — Brevo emits no per-event UUID. UNIQUE for idempotent webhook upserts. SendGrid used sendgrid_event_id.';

-- Teach the unsubscribe-sync trigger Brevo's event names. Purely additive: the
-- SendGrid event names stay so the old webhook keeps mirroring during cutover.
-- Brevo marketing payloads report 'unsubscribe' (already covered), plus 'spam'
-- (complaint) and 'hard_bounce' (dead address) — both should suppress the
-- address, mapping to a non-NULL email_unsubscribed_at.
create or replace function app.sync_email_unsubscribe()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.event_type in (
    'unsubscribe', 'spamreport', 'group_unsubscribe', 'dropped', -- SendGrid
    'spam', 'hard_bounce'                                         -- Brevo
  ) then
    if new.contact_id is not null then
      update public.contacts
        set email_unsubscribed_at = coalesce(email_unsubscribed_at, new.occurred_at)
        where id = new.contact_id and email_unsubscribed_at is null;
    elsif new.email is not null then
      update public.contacts
        set email_unsubscribed_at = coalesce(email_unsubscribed_at, new.occurred_at)
        where email = new.email and email_unsubscribed_at is null;
    end if;
  end if;
  return new;
end;
$$;
