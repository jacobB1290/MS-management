-- MMS media support.
--
-- Twilio fetches MMS media from a public HTTPS URL, so attachments are
-- uploaded to a PUBLIC Storage bucket with unguessable (UUID) object names.
-- Writes only ever happen server-side via the service-role key (the upload
-- route); the public flag just lets Twilio and the operator UI read the
-- object back by its random URL. Size + type are capped at the storage layer
-- as defense in depth on top of the upload route's own validation.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mms-media',
  'mms-media',
  true,
  5242880, -- 5 MB; Twilio MMS practical ceiling
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Per-recipient MMS attachment for campaigns. NULL = plain SMS campaign.
alter table public.campaigns
  add column if not exists media_url text;

comment on column public.campaigns.media_url is
  'Public URL of an MMS media attachment sent with every recipient message. NULL means a plain SMS campaign.';
