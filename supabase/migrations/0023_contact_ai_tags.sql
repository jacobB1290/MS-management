-- Provenance for contact tags: which tags were applied by the background AI
-- auto-tagger with no human in the loop. `tags` stays the single source of
-- truth for display/filtering; `ai_tags` is the subset of `tags` the AI added.
-- A tag a human adds or confirms is NOT in ai_tags, so the UI can mark
-- unconfirmed AI tags and the tagger can treat staff tags as authoritative.
alter table public.contacts
  add column if not exists ai_tags text[] not null default '{}';

comment on column public.contacts.ai_tags is
  'Subset of tags[] applied by the background AI auto-tagger with no human review. Human-added or human-confirmed tags are excluded. Display and filtering still use tags[].';
