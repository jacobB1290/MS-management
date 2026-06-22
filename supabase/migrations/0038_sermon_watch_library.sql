-- Watch-library backbone (ms.church /watch redesign).
--
-- A weekly service's MESSAGE is either a sermon or a 2-host discussion (with
-- occasional congregational Q&A), so we record the FORMAT and the SPEAKERS
-- (the pastor, or the hosts). TOPICS is a self-managing keyword set the
-- segmenter reuses or extends on each run (same reuse-first idea as contact
-- tags) — it drives the public library's topic filter + the SEO topic pages.
--
-- These columns are additive; existing rows default to a 'sermon' with empty
-- speakers/topics, so nothing breaks before a re-run repopulates them.

alter table public.sermons
  add column if not exists format text not null default 'sermon'
    check (format in ('sermon', 'discussion')),
  add column if not exists speakers text[] not null default '{}',
  add column if not exists topics text[] not null default '{}';

-- Topic filtering (public feed + CRM library) and the SEO topic pages.
create index if not exists sermons_topics_gin on public.sermons using gin (topics);

-- Library tab filtering by format among the published rows the site reads.
create index if not exists sermons_format_published_idx
  on public.sermons (format) where status = 'published';
