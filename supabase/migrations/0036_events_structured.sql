-- 0036_events_structured.sql
-- Richer authored event content, now that the CRM (not raw Google Calendar) is
-- the authoring surface. These map into the calendar event description as a
-- block of [Key: value] tags (see src/server/google/eventMapping.ts) that
-- ms.church parses back out and renders in the event detail view:
--   cost              -> [Cost: ...]
--   ages              -> [Ages: ...]
--   rsvp_by           -> [RSVP by: ...]
--   secondary_cta_*   -> a second [CTA: text | url] (the primary stays cta_*)
--
-- All nullable + additive; existing events and the calendar sync round-trip are
-- unaffected (a missing tag simply parses back to NULL).

alter table public.events
  add column if not exists cost text,
  add column if not exists ages text,
  add column if not exists rsvp_by text,
  add column if not exists secondary_cta_text text,
  add column if not exists secondary_cta_url text;

comment on column public.events.cost is 'Optional "Cost" fact (e.g. Free, $10). Serialized into the gcal description as [Cost: ...]; ms.church renders it in the event detail view.';
comment on column public.events.ages is 'Optional "Who / Ages" fact (e.g. All ages, Grades 6-12). Serialized as [Ages: ...].';
comment on column public.events.rsvp_by is 'Optional "RSVP by" fact (free text, e.g. April 1). Serialized as [RSVP by: ...].';
comment on column public.events.secondary_cta_text is 'Optional second button label. Serialized as a second [CTA: text | url]; the primary button stays cta_text/cta_url.';
comment on column public.events.secondary_cta_url is 'Optional second button link (a full https URL). Pairs with secondary_cta_text.';
