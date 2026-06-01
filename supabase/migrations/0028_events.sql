-- 0028_events.sql
-- Events: the CRM's two-way editor + mirror for the church Google Calendar that
-- ms.church renders. Google Calendar stays the source of truth for PUBLISHED
-- events (the public site reads it directly); this table mirrors those events
-- (keyed by gcal_event_id) so staff can browse/search/edit them in the CRM, and
-- it also holds CRM-only drafts (gcal_event_id NULL) plus metadata the calendar
-- can't carry well: a structured CTA, the flyer's Drive file id + public render
-- URL, a Supabase-Storage copy of the flyer, who created it, and the campaign
-- link.
--
-- Field mapping to a Google Calendar event (see src/server/google/eventMapping.ts):
--   title                     -> summary
--   starts_at/ends_at/all_day -> start/end (date for all-day, dateTime otherwise)
--   location                  -> location
--   description               -> description with the CTA appended as `[CTA: text | url]`
--   cta_text/cta_url          -> that [CTA:...] tag (ms.church renders it as the flyer button)
--   image_drive_file_id       -> attachments[0] (a public Drive image; the site shows it)
--
-- Mirrors the RLS + trigger shape of 0020_cases exactly: staff read/write,
-- admin delete, updated_at trigger. Default-deny RLS is the wall; the Google
-- writes happen server-side with OAuth, gated behind requireStaff in the routes.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  -- The Google Calendar event id once published; NULL while a CRM-only draft.
  -- UNIQUE so a calendar event maps to exactly one row (idempotent sync).
  gcal_event_id text unique,
  -- Which calendar the event lives on (defaults to the church calendar in code).
  -- Kept explicit so a future second calendar doesn't need a migration.
  gcal_calendar_id text,
  title text not null,
  -- Human description WITHOUT the [CTA:...] tag (that's reconstructed on write
  -- from cta_text/cta_url). What staff type and what the site shows as body.
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  -- Structured CTA. Serialized into the gcal description as `[CTA: text | url]`,
  -- which ms.church renders as the button overlaid on the flyer. url should be a
  -- full https URL (the site only renders http(s) CTAs, not anchors like #contact).
  cta_text text,
  cta_url text,
  -- Flyer image. image_drive_file_id backs the calendar attachment the public
  -- site reads; image_public_url is the lh3.googleusercontent.com render URL;
  -- image_storage_path is the CRM's own copy in the mms-media bucket (used for
  -- the editor preview and for MMS/email promo, and as the source bytes we
  -- upload to Drive on publish).
  image_drive_file_id text,
  image_public_url text,
  image_storage_path text,
  -- draft    : CRM-only, not yet on the calendar (not public).
  -- published: live on the calendar (public on ms.church).
  -- cancelled: cancelled on the calendar (the site drops status='cancelled').
  status text not null default 'draft'
    check (status in ('draft', 'published', 'cancelled')),
  -- crm  : created in this CRM.
  -- gcal : first seen via sync from the calendar (created elsewhere).
  source text not null default 'crm' check (source in ('crm', 'gcal')),
  -- Last time we reconciled this row from the calendar.
  synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Listing: upcoming/past split orders by start; status filter is common.
create index if not exists events_starts_at_idx on public.events (starts_at desc);
create index if not exists events_status_idx on public.events (status, starts_at desc);

alter table public.events enable row level security;

-- Staff manage events; admins may delete. Google writes happen server-side with
-- OAuth (bypasses RLS), gated by requireStaff in the route handlers.
create policy events_staff_read on public.events
  for select to authenticated using (app.is_staff());
create policy events_staff_insert on public.events
  for insert to authenticated with check (app.is_staff());
create policy events_staff_update on public.events
  for update to authenticated using (app.is_staff()) with check (app.is_staff());
create policy events_admin_delete on public.events
  for delete to authenticated using (app.is_admin());

create trigger events_updated_at
  before update on public.events
  for each row execute function app.set_updated_at();

-- Link a promo campaign to the event it announces (nullable; set null on delete
-- so deleting an event never destroys the campaign record / its audit trail).
alter table public.campaigns
  add column if not exists event_id uuid references public.events(id) on delete set null;

create index if not exists campaigns_event_idx
  on public.campaigns (event_id) where event_id is not null;
