-- 0025_email_two_way.sql
-- Two-way email in the inbox. Email becomes a third channel alongside sms/mms/
-- form: outbound 1:1 replies and inbound replies land in the SAME `messages`
-- thread per contact, so a conversation can mix SMS and email exactly the way
-- the operator UI already renders any direction-tagged bubble.
--
-- Purely additive. Widening the channel CHECK can never invalidate a row, and
-- every new column is nullable (SMS rows simply leave them null).

-- 1) Allow 'email' as a message channel. The constraint is auto-named
-- `messages_channel_check`; drop + recreate with the extra value (matches 0022).
alter table public.messages
  drop constraint if exists messages_channel_check;

alter table public.messages
  add constraint messages_channel_check
  check (channel in ('sms', 'mms', 'form', 'email'));

-- 2) Email-specific columns.
--   subject              — email threads carry a subject; SMS leaves it null.
--   body_html            — raw inbound HTML, kept for the record. NOT rendered
--                          as-is: any HTML render MUST sanitize first. The inbox
--                          renders the plain-text `body` only.
--   provider_message_id  — SendGrid x-message-id (outbound) or the inbound
--                          Message-ID header. Idempotency key for inbound parse
--                          retries, mirroring twilio_sid for SMS.
--   email_meta           — envelope/header crumbs (from, to, message_id,
--                          in_reply_to, references) for threading + audit.
alter table public.messages
  add column if not exists subject text,
  add column if not exists body_html text,
  add column if not exists provider_message_id text,
  add column if not exists email_meta jsonb;

-- Idempotency: a partial unique index so the many SMS rows (null) never collide,
-- while inbound-email retries with the same Message-ID dedupe to one row.
create unique index if not exists messages_provider_message_id_key
  on public.messages (provider_message_id)
  where provider_message_id is not null;

-- 3) Surface the last message's channel + subject on the conversation list so
-- the inbox can badge an email thread without a second round-trip. Drop +
-- recreate (Postgres won't add a column to a view via CREATE OR REPLACE).
drop view if exists public.contact_summary;

create view public.contact_summary
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.phone,
  c.email,
  c.tags,
  c.language,
  c.sms_opted_out_at,
  c.email_unsubscribed_at,
  c.is_member,
  c.inbox_category,
  c.inbox_status,
  c.created_at,
  m.created_at as last_message_at,
  (select count(*) from public.messages where contact_id = c.id) as message_count,
  m.body as last_message_body,
  m.direction as last_message_direction,
  m.channel as last_message_channel,
  m.subject as last_message_subject
from public.contacts c
left join lateral (
  select created_at, body, direction, channel, subject
  from public.messages
  where contact_id = c.id
  order by created_at desc
  limit 1
) m on true;
