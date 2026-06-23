-- Worship songs per service (the /watch Songs library).
--
-- Each week's worship is split by the segmenter into individual SONGS (title +
-- who led it + its time bounds in the recording). Auto-only: the AI fills this;
-- staff don't edit it. The public site flattens songs across services into a
-- Songs library where each plays just that song clip via the segment player.
--
-- Shape (jsonb array): [{ "title": text, "leader": text|null,
--                          "startSec": int, "endSec": int }]
-- Additive; existing rows default to an empty array until a re-run fills them.

alter table public.sermons
  add column if not exists songs jsonb not null default '[]'::jsonb;
