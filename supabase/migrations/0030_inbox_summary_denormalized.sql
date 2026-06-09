-- 0030_inbox_summary_denormalized.sql
-- The inbox conversation list reads contact_summary, which computed a
-- per-contact count(*) plus a lateral last-message subquery for EVERY contact
-- on every load. That is O(total messages) work per inbox paint, it grows with
-- history, and the ORDER BY last_message_at on a computed view column can
-- never use an index. Denormalize the last-message snapshot + count onto
-- contacts (kept current by trigger), make the view a thin select over those
-- columns, and give the inbox ordering a real partial index.
--
-- The view keeps its exact name and column set, so every reader
-- (inbox layout, conversation list types, demo fixtures) is unchanged.

-- ---------------------------------------------------------------------------
-- 1) Denormalized columns on contacts
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column if not exists last_message_at timestamptz,
  add column if not exists last_message_body text,
  add column if not exists last_message_direction text,
  add column if not exists last_message_channel text,
  add column if not exists last_message_subject text,
  add column if not exists message_count integer not null default 0;

comment on column public.contacts.last_message_at is
  'Denormalized from messages by app.sync_contact_message_summary(); do not write directly.';
comment on column public.contacts.message_count is
  'Denormalized from messages by app.sync_contact_message_summary(); do not write directly.';

-- ---------------------------------------------------------------------------
-- 2) Backfill from existing messages
-- ---------------------------------------------------------------------------
update public.contacts c
set
  last_message_at        = m.last_created_at,
  last_message_body      = m.last_body,
  last_message_direction = m.last_direction,
  last_message_channel   = m.last_channel,
  last_message_subject   = m.last_subject,
  message_count          = m.cnt
from (
  select
    contact_id,
    count(*)::int                                            as cnt,
    (array_agg(created_at order by created_at desc))[1]      as last_created_at,
    (array_agg(body       order by created_at desc))[1]      as last_body,
    (array_agg(direction  order by created_at desc))[1]      as last_direction,
    (array_agg(channel    order by created_at desc))[1]      as last_channel,
    (array_agg(subject    order by created_at desc))[1]      as last_subject
  from public.messages
  group by contact_id
) m
where m.contact_id = c.id;

-- ---------------------------------------------------------------------------
-- 3) Maintenance trigger. INSERT is the hot path (one atomic UPDATE, no
--    subquery: all SET expressions read the OLD row, so the head comparison is
--    consistent across columns and concurrent inserts serialize on the row
--    lock). DELETE/UPDATE are rare paths and may recompute via the
--    (contact_id, created_at desc) index. Status/pricing updates from the
--    Twilio callbacks never fire it: the UPDATE trigger is scoped to the
--    columns the summary actually mirrors.
-- ---------------------------------------------------------------------------
create or replace function app.sync_contact_message_summary()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.contacts c
    set
      message_count = c.message_count + 1,
      last_message_at = case
        when c.last_message_at is null or new.created_at >= c.last_message_at
        then new.created_at else c.last_message_at end,
      last_message_body = case
        when c.last_message_at is null or new.created_at >= c.last_message_at
        then new.body else c.last_message_body end,
      last_message_direction = case
        when c.last_message_at is null or new.created_at >= c.last_message_at
        then new.direction else c.last_message_direction end,
      last_message_channel = case
        when c.last_message_at is null or new.created_at >= c.last_message_at
        then new.channel else c.last_message_channel end,
      last_message_subject = case
        when c.last_message_at is null or new.created_at >= c.last_message_at
        then new.subject else c.last_message_subject end
    where c.id = new.contact_id;
    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.contacts c
    set message_count = greatest(c.message_count - 1, 0)
    where c.id = old.contact_id;
    -- Deleted the displayed head: re-derive the snapshot from what remains
    -- (NULLs when the thread is now empty, which removes it from the inbox).
    update public.contacts c
    set (last_message_at, last_message_body, last_message_direction,
         last_message_channel, last_message_subject) =
      (select m.created_at, m.body, m.direction, m.channel, m.subject
       from public.messages m
       where m.contact_id = c.id
       order by m.created_at desc
       limit 1)
    where c.id = old.contact_id
      and c.last_message_at is not distinct from old.created_at;
    return old;
  end if;

  -- UPDATE of a mirrored column (rare: edits, re-parenting a message).
  if old.contact_id is distinct from new.contact_id then
    update public.contacts c
    set message_count = greatest(c.message_count - 1, 0)
    where c.id = old.contact_id;
    update public.contacts c
    set message_count = c.message_count + 1
    where c.id = new.contact_id;
  end if;
  update public.contacts c
  set (last_message_at, last_message_body, last_message_direction,
       last_message_channel, last_message_subject) =
    (select m.created_at, m.body, m.direction, m.channel, m.subject
     from public.messages m
     where m.contact_id = c.id
     order by m.created_at desc
     limit 1)
  where c.id in (old.contact_id, new.contact_id);
  return new;
end;
$$;

drop trigger if exists messages_sync_contact_summary_ins on public.messages;
drop trigger if exists messages_sync_contact_summary_del on public.messages;
drop trigger if exists messages_sync_contact_summary_upd on public.messages;

create trigger messages_sync_contact_summary_ins
  after insert on public.messages
  for each row execute function app.sync_contact_message_summary();
create trigger messages_sync_contact_summary_del
  after delete on public.messages
  for each row execute function app.sync_contact_message_summary();
create trigger messages_sync_contact_summary_upd
  after update of contact_id, created_at, body, channel, direction, subject
  on public.messages
  for each row execute function app.sync_contact_message_summary();

-- ---------------------------------------------------------------------------
-- 4) Thin view (same name, same columns) + the index the inbox order needed
-- ---------------------------------------------------------------------------
drop view if exists public.contact_summary;

create view public.contact_summary
with (security_invoker = true) as
select
  id,
  name,
  phone,
  email,
  tags,
  language,
  sms_opted_out_at,
  email_unsubscribed_at,
  is_member,
  inbox_category,
  inbox_status,
  created_at,
  last_message_at,
  message_count,
  last_message_body,
  last_message_direction,
  last_message_channel,
  last_message_subject
from public.contacts;

create index if not exists contacts_last_message_at_idx
  on public.contacts (last_message_at desc)
  where last_message_at is not null;
