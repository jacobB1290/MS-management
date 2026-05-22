-- 0002_advisor_fixups.sql
-- Address security advisors from 0001:
--   * app.set_updated_at had a mutable search_path
--   * citext and pg_trgm were installed in the public schema

create schema if not exists extensions;

alter extension citext set schema extensions;
alter extension pg_trgm set schema extensions;

-- Ensure the application sees these extension objects without schema-qualification.
-- (search_path on the role is already set globally; this is belt-and-braces.)
grant usage on schema extensions to anon, authenticated, service_role;

create or replace function app.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
