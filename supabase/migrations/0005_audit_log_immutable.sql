-- 0005_audit_log_immutable.sql
-- Even service_role cannot UPDATE or DELETE audit_log rows. Append-only is
-- the whole point of this table — RLS default-denies authenticated/anon
-- writes already; this closes the service-role hole.

revoke update, delete on public.audit_log from anon, authenticated, service_role;

create or replace function app.audit_log_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

drop trigger if exists audit_log_block_update on public.audit_log;
drop trigger if exists audit_log_block_delete on public.audit_log;
create trigger audit_log_block_update before update on public.audit_log
  for each row execute function app.audit_log_block_mutation();
create trigger audit_log_block_delete before delete on public.audit_log
  for each row execute function app.audit_log_block_mutation();
