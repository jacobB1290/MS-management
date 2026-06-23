-- 0042_sermon_generated_title.sql
-- A descriptive, AI-generated public title for the service (centered on the
-- message), so the watch library and search engines see "The Lord's Prayer as a
-- Blueprint for Fathers" instead of the raw YouTube livestream title
-- ("LIVE - Sunday Morning 9:00am | 6/21/2026 | Morning Star Church of Boise").
--
-- The segmenter writes this in the same pass that titles the songs and chapters.
-- sermons.title stays the SOURCE YouTube title (the CRM keeps it for reference
-- and the slug is derived from it); the public feed serves generated_title with
-- a fallback to title, so a not-yet-re-run service still shows its old title.
-- Nullable + best-effort write, like the other watch-library columns, so a
-- pre-migration database still completes a segmentation run.

alter table public.sermons
  add column if not exists generated_title text;
