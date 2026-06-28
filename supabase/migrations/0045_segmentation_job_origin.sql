-- 0045_segmentation_job_origin.sql
-- Auto-publish modes (Settings -> Services) let a completed segmentation land at
-- `published` instead of `review`, with two independent toggles: one for
-- automatic runs (Monday cron, back-catalog drain, session finalize) and one for
-- a hand-kicked "Run now". The session/finalize path runs out-of-band in the
-- cron, long after the run that created the job, so it can't see the original
-- trigger. Stamp the run's origin onto the job at enqueue time so
-- `finalizeReturnedSegmentationJobs` can apply the right toggle. Purely additive
-- and defaulted, so existing pending/returned jobs keep working as "automatic".

alter table public.segmentation_jobs
  add column if not exists origin text not null default 'automatic'
    check (origin in ('automatic', 'manual'));

comment on column public.segmentation_jobs.origin is
  'Which run produced this job: ''manual'' (a hand-kicked Run now) or ''automatic'' (cron / back-catalog drain / max_tokens fallback). Drives the auto-publish landing status at finalize.';
