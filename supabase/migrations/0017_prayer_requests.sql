-- Prayer requests: structured intake for prayer needs, the first of the
-- transactional modules. A request may be tied to a contact (so staff can
-- follow up by text under the transactional_prayer consent basis) or stand
-- alone for a walk-in / anonymous request.
create table if not exists public.prayer_requests (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts(id) on delete set null,
  requester_name text,
  body text not null,
  status text not null default 'new'
    check (status in ('new', 'praying', 'answered', 'archived')),
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prayer_requests_status_idx
  on public.prayer_requests (status, created_at desc);
create index if not exists prayer_requests_contact_idx
  on public.prayer_requests (contact_id);

alter table public.prayer_requests enable row level security;

-- Staff manage prayer requests; admins may delete. Sending happens server-side
-- with the service-role key (bypasses RLS), gated by assertCanSendSms.
create policy prayer_requests_staff_read on public.prayer_requests
  for select to authenticated using (app.is_staff());
create policy prayer_requests_staff_insert on public.prayer_requests
  for insert to authenticated with check (app.is_staff());
create policy prayer_requests_staff_update on public.prayer_requests
  for update to authenticated using (app.is_staff()) with check (app.is_staff());
create policy prayer_requests_admin_delete on public.prayer_requests
  for delete to authenticated using (app.is_admin());

create trigger prayer_requests_updated_at
  before update on public.prayer_requests
  for each row execute function app.set_updated_at();
