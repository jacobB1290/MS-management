-- Allow short video in MMS, alongside images. The 5 MB cap stays (Twilio's
-- ceiling), so video must be brief. Updates the existing mms-media bucket.

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/3gpp', 'video/quicktime'
]
where id = 'mms-media';
