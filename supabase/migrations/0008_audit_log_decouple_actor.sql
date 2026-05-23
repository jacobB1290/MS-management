-- 0008_audit_log_decouple_actor.sql
-- Decouple audit_log.actor_user_id from auth.users.
--
-- Original schema in 0001 used ON DELETE SET NULL so user deletions
-- cascade-NULL the actor reference. Combined with the append-only
-- trigger added in 0005, any user deletion that had audit history
-- raised "audit_log is append-only" and rolled back.
--
-- Decoupling fixes both behaviors at once: audit_log entries are
-- historical snapshots that retain the actor's UUID as a plain value,
-- so deleting a user leaves their audit fingerprint intact (which is
-- what compliance actually wants) and the immutability invariant
-- becomes a true invariant — no path mutates an existing row.

do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.audit_log'::regclass
    and contype = 'f'
    and array_position(conkey, (
      select attnum from pg_attribute
      where attrelid = 'public.audit_log'::regclass
        and attname = 'actor_user_id'
    )) is not null
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.audit_log drop constraint %I', v_constraint_name);
  end if;
end $$;
