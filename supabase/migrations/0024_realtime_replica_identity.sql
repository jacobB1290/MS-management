-- Make UPDATE/DELETE realtime events actually fire for the inbox.
--
-- contacts and messages are in the supabase_realtime publication and have RLS
-- (staff-only). With the default replica identity (primary key only), Postgres
-- logs just the PK for UPDATE/DELETE, and the WAL omits unchanged TOASTed
-- columns (contacts.notes, tags[], ai_tags[]). Supabase Realtime then can't
-- reconstruct the row to clear the RLS check, so the change is silently
-- dropped: INSERTs (new messages) arrive live, but UPDATEs (AI auto-tags,
-- auto-notes, triage segment/status, opt-out flips, message status) and the
-- contact DELETE only show up after a manual refresh.
--
-- REPLICA IDENTITY FULL logs the full old row, so UPDATE/DELETE events pass the
-- RLS check and deliver. Volume here is tiny (a low-traffic church CRM on the
-- free tier), so the extra WAL is a non-issue.
alter table public.contacts replica identity full;
alter table public.messages replica identity full;
