-- church_knowledge: the factual knowledge base the AI drafting tool can look up
-- (service times, Bible studies, ministries, beliefs, how to visit/join, etc.).
--
-- Two provenances live in one table:
--   - source = 'website': synced from ms.church (the always-current source of
--     truth). Carries source_url + content_hash so the sync can skip unchanged
--     pages and deactivate pages that disappear. Managed only by the service-
--     role sync job; never hand-edited.
--   - source = 'staff':   entries staff add by hand in Settings for things the
--     website doesn't cover.
--
-- The draft engine never reads this directly from the browser; a server-side
-- tool (lookup_church_info) queries it via the service-role client, so the
-- only RLS need is letting signed-in staff READ it for the Settings list.
-- Writes go through admin-/staff-gated route handlers on the service-role
-- client, so there is intentionally no authenticated write policy here.

create table if not exists public.church_knowledge (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  source text not null default 'staff' check (source in ('website', 'staff')),
  -- Set for website entries (the page they came from); null for staff entries.
  source_url text,
  -- sha256 of the extracted body, so a sync run can tell changed from unchanged.
  content_hash text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Full-text index source. English config is plenty for church-scale content;
  -- no embeddings (keeps it free + deterministic).
  search_tsv tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored
);

-- One row per website page; staff rows have null source_url (ignored here).
create unique index if not exists church_knowledge_source_url_uniq
  on public.church_knowledge (source_url) where source_url is not null;
create index if not exists church_knowledge_search
  on public.church_knowledge using gin (search_tsv);
create index if not exists church_knowledge_active
  on public.church_knowledge (updated_at desc) where is_active;

create trigger church_knowledge_updated_at before update on public.church_knowledge
  for each row execute function app.set_updated_at();

alter table public.church_knowledge enable row level security;

-- Any signed-in staffer may read (the Settings list). No authenticated write
-- policy: all writes happen via service-role route handlers (default-deny wall).
create policy "church_knowledge_staff_read"
  on public.church_knowledge for select to authenticated
  using (app.is_staff());

-- Ranked lookup for the AI tool. The model's queries are loose keyword phrases
-- ("bible study times", "youth group"), so we OR the words together rather than
-- AND them: whitespace becomes the websearch "or" operator. (Plain
-- websearch_to_tsquery ANDs every term, so one absent word like "times" would
-- drop an otherwise-perfect "Bible studies" hit.) An ILIKE fallback catches a
-- distinctive literal phrase, and an empty query returns the most recently
-- updated entries so the model always has something. Called server-side via the
-- service-role client; SECURITY INVOKER is fine (service role bypasses RLS).
create or replace function public.search_church_knowledge(p_query text, p_limit int default 5)
returns setof public.church_knowledge
language sql
stable
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(coalesce(p_query, '')), '') as raw,
      websearch_to_tsquery(
        'english',
        regexp_replace(coalesce(nullif(btrim(coalesce(p_query, '')), ''), ''), '\s+', ' or ', 'g')
      ) as tsq
  )
  select k.*
  from public.church_knowledge k, params p
  where k.is_active
    and (
      p.raw is null
      or k.search_tsv @@ p.tsq
      or k.title ilike '%' || p.raw || '%'
      or k.body ilike '%' || p.raw || '%'
    )
  order by ts_rank(k.search_tsv, p.tsq) desc, k.updated_at desc
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;

comment on table public.church_knowledge is
  'Factual church info the AI drafting tool looks up. source=website is synced from ms.church; source=staff is hand-added in Settings.';
