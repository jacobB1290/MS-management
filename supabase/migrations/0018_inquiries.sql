-- Inquiries: structured intake for general questions ("how do I get baptized?",
-- "when is the next membership class?"). Second transactional module. Mirrors
-- prayer_requests: may be tied to a contact (so staff can reply by text under
-- the transactional_inquiry consent basis) or stand alone.
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts(id) on delete set null,
  requester_name text,
  topic text,
  body text not null,
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inquiries_status_idx
  on public.inquiries (status, created_at desc);
create index if not exists inquiries_contact_idx
  on public.inquiries (contact_id);

alter table public.inquiries enable row level security;

create policy inquiries_staff_read on public.inquiries
  for select to authenticated using (app.is_staff());
create policy inquiries_staff_insert on public.inquiries
  for insert to authenticated with check (app.is_staff());
create policy inquiries_staff_update on public.inquiries
  for update to authenticated using (app.is_staff()) with check (app.is_staff());
create policy inquiries_admin_delete on public.inquiries
  for delete to authenticated using (app.is_admin());

create trigger inquiries_updated_at
  before update on public.inquiries
  for each row execute function app.set_updated_at();
