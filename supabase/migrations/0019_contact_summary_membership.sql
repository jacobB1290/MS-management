-- 0019_contact_summary_membership.sql
-- Surface membership on the conversation list. Add is_member to the
-- contact_summary view so the inbox can badge + filter members without a
-- second round-trip to contacts. Drop + recreate because Postgres refuses to
-- add a column to an existing view via CREATE OR REPLACE.

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
  c.created_at,
  m.created_at as last_message_at,
  (select count(*) from public.messages where contact_id = c.id) as message_count,
  m.body as last_message_body,
  m.direction as last_message_direction
from public.contacts c
left join lateral (
  select created_at, body, direction
  from public.messages
  where contact_id = c.id
  order by created_at desc
  limit 1
) m on true;
