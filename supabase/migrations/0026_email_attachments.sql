-- Email attachment storage for 1:1 inbox email.
--
-- Unlike MMS media (public bucket, fetched by Twilio over HTTPS), email
-- attachments ride the message as real SendGrid attachments — the provider
-- never fetches them by URL. So this bucket is PRIVATE: only the service-role
-- key (used by the upload route and the send path) ever reads or writes it.
-- Object names are server-generated UUIDs. Type + size are capped here as
-- defense in depth on top of the upload route's own validation.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'email-attachments',
  'email-attachments',
  false,
  26214400, -- 25 MB; below SendGrid's ~30 MB ceiling
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No public storage policies are created: this bucket is reachable only via the
-- service-role key (RLS-exempt), which is exactly the server-side send/upload
-- path. The default-deny posture on storage.objects keeps the anon/auth roles
-- out entirely.
