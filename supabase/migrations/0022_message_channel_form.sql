-- 0022_message_channel_form.sql
-- Public website form submissions seed the contact's inbox thread with the
-- message the person typed ("your question, prayer request, or message"). That
-- message is a real inbound, but it did NOT arrive over SMS/MMS — so faking its
-- channel as 'sms' would inflate SMS metrics and lie about provenance. Widen the
-- messages.channel CHECK to allow a dedicated 'form' value instead.
--
-- Purely additive: widening a CHECK to permit more values can never invalidate
-- an existing row. The inline constraint from 0001 is auto-named
-- `messages_channel_check`; drop and recreate it with the extra value.

alter table public.messages
  drop constraint if exists messages_channel_check;

alter table public.messages
  add constraint messages_channel_check
  check (channel in ('sms', 'mms', 'form'));
