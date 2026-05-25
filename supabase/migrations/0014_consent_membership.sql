-- Consent + membership model (context-tagged send gate).
--
-- Two consent bases coexist, plus a hard stop:
--   * STOP (sms_opted_out_at) — universal hard block, unchanged.
--   * Conversational/implied — you may reply within a window of the contact's
--     last inbound. Computed live from messages (no stored timer).
--   * Marketing/express — explicit opt-in (reply YES/JOIN, web form, or staff)
--     required for campaigns/newsletters.
-- Membership (#11) is a first-class flag, not a tag.

alter table public.contacts
  add column if not exists marketing_consent_at timestamptz,
  add column if not exists marketing_consent_method text,
  add column if not exists marketing_opted_out_at timestamptz,
  add column if not exists marketing_opt_in_requested_at timestamptz,
  add column if not exists is_member boolean not null default false;

comment on column public.contacts.marketing_consent_at is
  'Express opt-in to recurring/marketing messages (campaigns). NULL = not opted in. Distinct from sms_opted_out_at (global STOP).';
comment on column public.contacts.marketing_opted_out_at is
  'Declined marketing specifically while still reachable conversationally. NULL = has not declined.';
comment on column public.contacts.marketing_opt_in_requested_at is
  'When the last opt-in invitation was sent; gates one-per-conversation and the stale reset.';
comment on column public.contacts.is_member is
  'True when the contact is a church member (vs visitor/other). Drives inbox grouping + campaign targeting.';

-- Which consent context authorized each outbound send (audit + gate record).
alter table public.messages
  add column if not exists context text;
comment on column public.messages.context is
  'Consent context that authorized this send: conversational_reply, marketing_newsletter, marketing_promotional, opt_in_request, transactional_event, transactional_prayer, transactional_inquiry.';

create index if not exists contacts_is_member_idx on public.contacts (is_member) where is_member;
