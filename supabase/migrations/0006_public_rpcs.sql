-- 0006_public_rpcs.sql
-- The RPCs introduced in 0004 live in the `app` schema, but Supabase's
-- Data API only exposes `public`/`storage`/`graphql_public` by default.
-- Calling them via `.rpc("...")` fails with:
--   "Could not find the function public.upsert_contact_by_phone_or_email"
--
-- Move both functions + their composite type into `public` so they're
-- reachable via PostgREST without changing the Supabase project's exposed-
-- schemas list.

alter function app.upsert_contact_by_phone_or_email(
  text, text, citext, text, text, timestamptz, text[], text
) set schema public;

alter function app.claim_campaign_batch(uuid, int) set schema public;

alter type app.contact_upsert_result set schema public;

-- Ensure service_role retains EXECUTE in the new schema (ALTER FUNCTION
-- SET SCHEMA preserves ACL but be defensive).
revoke all on function public.upsert_contact_by_phone_or_email(
  text, text, citext, text, text, timestamptz, text[], text
) from public;
grant execute on function public.upsert_contact_by_phone_or_email(
  text, text, citext, text, text, timestamptz, text[], text
) to service_role;

revoke all on function public.claim_campaign_batch(uuid, int) from public;
grant execute on function public.claim_campaign_batch(uuid, int) to service_role;

-- Tell PostgREST to refresh its schema cache so the move is visible now.
notify pgrst, 'reload schema';
