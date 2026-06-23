-- 0041_sermon_backfill_reprocess.sql
-- Let staff RE-RUN an already-processed (or published) past service from the
-- "Process past services" picker, in bulk, through the same server-side queue.
--
-- Until now the backfill queue only ever ran the pipeline for the FIRST time:
-- enqueue skipped any video that already had a sermon row, and the worker called
-- the pipeline without `force`, so a published service could never be re-run from
-- the picker (only one-at-a-time from its detail page). This flag carries the
-- operator's intent ("re-run this one even though it's already done") from the
-- enqueue call to the worker, which passes it through as the pipeline's `force`.
--
-- A re-run re-downloads captions, re-segments, and lands the sermon back at
-- status 'review' (exactly like the existing single-sermon "Run again"), so a
-- human re-publishes it — we still never auto-publish AI output to the live site.

alter table public.sermon_backfill_queue
  add column if not exists reprocess boolean not null default false;
