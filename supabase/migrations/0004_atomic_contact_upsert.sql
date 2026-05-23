-- 0004_atomic_contact_upsert.sql
-- Data-integrity fixes from the review panel:
--  * Add UNIQUE on contacts.email so email-only dedupe is sound.
--  * Replace read-then-insert contact creation with a single atomic upsert RPC
--    that all three creation paths (public-form, twilio-inbound, manual) call
--    instead of racing on the UNIQUE constraint.
--  * Add an atomic campaign-batch claim function (SELECT FOR UPDATE SKIP LOCKED)
--    so concurrent cron invocations can't double-send.

-- ---------------------------------------------------------------------------
-- UNIQUE on email (partial: NULLs allowed)
-- ---------------------------------------------------------------------------
create unique index if not exists contacts_email_unique
  on public.contacts (email)
  where email is not null;

-- ---------------------------------------------------------------------------
-- Atomic contact upsert. Returns the resulting contact id and a flag
-- indicating whether the row was newly created. NEVER overwrites a non-null
-- phone/email with a conflicting value — those collisions return a
-- `needs_review` flag so the caller can route to a merge UI instead of
-- silently poisoning an existing record.
-- ---------------------------------------------------------------------------
create type app.contact_upsert_result as (
  contact_id uuid,
  created boolean,
  needs_review boolean,
  conflict_with uuid
);

create or replace function app.upsert_contact_by_phone_or_email(
  p_name text,
  p_phone text,
  p_email citext,
  p_source text,
  p_consent_method text,
  p_consent_at timestamptz,
  p_tags text[] default null,
  p_language text default 'en'
) returns app.contact_upsert_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone_id uuid;
  v_email_id uuid;
  v_result app.contact_upsert_result;
  v_id uuid;
begin
  -- Look up both axes
  if p_phone is not null then
    select id into v_phone_id from public.contacts where phone = p_phone;
  end if;
  if p_email is not null then
    select id into v_email_id from public.contacts where email = p_email;
  end if;

  -- Two different existing contacts: refuse to silently merge.
  if v_phone_id is not null and v_email_id is not null and v_phone_id <> v_email_id then
    v_result.contact_id := v_phone_id;
    v_result.created := false;
    v_result.needs_review := true;
    v_result.conflict_with := v_email_id;
    return v_result;
  end if;

  v_id := coalesce(v_phone_id, v_email_id);

  if v_id is null then
    insert into public.contacts (
      name, phone, email, source, tags, language, consent_method, consent_at
    ) values (
      nullif(p_name, ''),
      p_phone,
      p_email,
      coalesce(p_source, 'manual'),
      coalesce(p_tags, '{}'::text[]),
      coalesce(p_language, 'en'),
      p_consent_method,
      coalesce(p_consent_at, now())
    )
    returning id into v_id;
    v_result.contact_id := v_id;
    v_result.created := true;
    v_result.needs_review := false;
    return v_result;
  end if;

  -- Existing contact — fill in missing fields ONLY; never overwrite non-null.
  update public.contacts c set
    name = coalesce(c.name, nullif(p_name, '')),
    phone = coalesce(c.phone, p_phone),
    email = coalesce(c.email, p_email),
    source = coalesce(c.source, p_source),
    consent_method = coalesce(c.consent_method, p_consent_method),
    consent_at = coalesce(c.consent_at, p_consent_at, now()),
    tags = case
      when array_length(coalesce(p_tags, '{}'), 1) is null then c.tags
      else (select array_agg(distinct t) from unnest(c.tags || p_tags) t)
    end
  where c.id = v_id;

  v_result.contact_id := v_id;
  v_result.created := false;
  v_result.needs_review := false;
  return v_result;
end;
$$;

revoke all on function app.upsert_contact_by_phone_or_email(
  text, text, citext, text, text, timestamptz, text[], text
) from public;
grant execute on function app.upsert_contact_by_phone_or_email(
  text, text, citext, text, text, timestamptz, text[], text
) to service_role;

-- ---------------------------------------------------------------------------
-- Atomic campaign-batch claim. Picks up to N queued recipients and flips them
-- to 'sending' in a single statement using SELECT FOR UPDATE SKIP LOCKED so
-- concurrent workers cannot claim the same rows.
-- ---------------------------------------------------------------------------
create or replace function app.claim_campaign_batch(
  p_campaign_id uuid,
  p_batch_size int
) returns table (contact_id uuid)
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    select campaign_id, contact_id
    from public.campaign_recipients
    where campaign_id = p_campaign_id and status = 'queued'
    order by sent_at nulls first
    limit p_batch_size
    for update skip locked
  )
  update public.campaign_recipients r
    set status = 'sending'
    from claimed
    where r.campaign_id = claimed.campaign_id
      and r.contact_id = claimed.contact_id
    returning r.contact_id;
$$;

revoke all on function app.claim_campaign_batch(uuid, int) from public;
grant execute on function app.claim_campaign_batch(uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- Status precedence helper for Twilio delivery callbacks. Prevents a late
-- 'sent' from overwriting a 'delivered' that arrived first.
-- ---------------------------------------------------------------------------
create or replace function app.message_status_rank(s text)
returns int
language sql
immutable
as $$
  select case s
    when 'received'    then 0
    when 'queued'      then 1
    when 'accepted'    then 2
    when 'sending'     then 3
    when 'sent'        then 4
    when 'delivered'   then 5
    when 'read'        then 6
    when 'undelivered' then 7
    when 'failed'      then 8
    when 'mocked'      then 9
    else null
  end;
$$;
