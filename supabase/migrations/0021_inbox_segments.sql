-- 0021_inbox_segments.sql
-- Pivot: one inbox with non-destructive segments instead of separate
-- prayer/inquiry modules. Classification lives ON the conversation (the
-- contact), not in a side table, so a segment is a filter over contacts and
-- per-conversation status is a single column. Members stays an independent
-- overlay (is_member), orthogonal to category.
--
-- Segments are non-destructive: `inbox_category = 'general'` is the default
-- and the catch-all, and the inbox's "General/All" view shows every
-- conversation regardless of category. Auto-classification only ever moves a
-- conversation between categories; it never removes it from the main list.
--
-- The previously-added `cases` table (0020) and the `prayer_requests` /
-- `inquiries` module tables are retired: all three are empty, and their
-- concepts now live as inbox segments. Dropping is safe (no data to migrate).

-- 1) Classification + per-conversation lifecycle on the contact.
-- Category is code-validated (see src/lib/inbox-segments.ts) rather than a DB
-- enum so a new segment ships without a migration and per-category status sets
-- can differ. 'general' is the default and the never-hidden catch-all.
alter table public.contacts
  add column if not exists inbox_category text not null default 'general',
  add column if not exists inbox_status text,
  add column if not exists inbox_category_at timestamptz,
  add column if not exists inbox_status_at timestamptz;

-- Segment-view + worklist lookups.
create index if not exists contacts_inbox_idx
  on public.contacts (inbox_category, inbox_status);

-- 2) Surface category + status on the conversation list. Drop + recreate
-- (Postgres won't add a column to an existing view via CREATE OR REPLACE).
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
  m.direction as last_message_direction
from public.contacts c
left join lateral (
  select created_at, body, direction
  from public.messages
  where contact_id = c.id
  order by created_at desc
  limit 1
) m on true;

-- 3) Retire the superseded tables. All empty; concepts now live as segments.
drop table if exists public.cases cascade;
drop table if exists public.prayer_requests cascade;
drop table if exists public.inquiries cascade;
