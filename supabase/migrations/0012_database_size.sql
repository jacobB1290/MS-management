-- Expose the database size (bytes) so Settings can show usage against the
-- free-tier ~500 MB database limit, next to the 1 GB file-storage bar.
-- SECURITY DEFINER + locked search_path; no dynamic SQL, no table access.

create or replace function public.database_size()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.pg_database_size(pg_catalog.current_database());
$$;

revoke all on function public.database_size() from public;
grant execute on function public.database_size() to authenticated;
