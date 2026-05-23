-- 0007_recreate_upsert_rpc.sql
-- After moving the function + type from `app` to `public` in 0006, the
-- function body still referenced the old type name (`app.contact_upsert_result`)
-- in its `declare`, causing every call to fail with:
--   type "app.contact_upsert_result" does not exist
-- ALTER FUNCTION SET SCHEMA only moves the metadata; it doesn't rewrite the
-- function body. Drop everything and recreate cleanly in public.

drop function if exists public.upsert_contact_by_phone_or_email(
  text, text, citext, text, text, timestamptz, text[], text
);

drop type if exists public.contact_upsert_result cascade;

create type public.contact_upsert_result as (
  contact_id uuid,
  created boolean,
  needs_review boolean,
  conflict_with uuid
);

create or replace function public.upsert_contact_by_phone_or_email(
  p_name text,
  p_phone text,
  p_email citext,
  p_source text,
  p_consent_method text,
  p_consent_at timestamptz,
  p_tags text[] default null,
  p_language text default 'en'
) returns public.contact_upsert_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone_id uuid;
  v_email_id uuid;
  v_result public.contact_upsert_result;
  v_id uuid;
begin
  if p_phone is not null then
    select id into v_phone_id from public.contacts where phone = p_phone;
  end if;
  if p_email is not null then
    select id into v_email_id from public.contacts where email = p_email;
  end if;

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

revoke all on function public.upsert_contact_by_phone_or_email(
  text, text, citext, text, text, timestamptz, text[], text
) from public;
grant execute on function public.upsert_contact_by_phone_or_email(
  text, text, citext, text, text, timestamptz, text[], text
) to service_role;

notify pgrst, 'reload schema';
