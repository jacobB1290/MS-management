-- 0003_inbox_essentials.sql
-- Surface last-message snippet on the conversation list. Extend the existing
-- contact_summary view; dropping + recreating is necessary because Postgres
-- refuses to rename view columns via CREATE OR REPLACE — new columns must
-- land after the existing ones.

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
