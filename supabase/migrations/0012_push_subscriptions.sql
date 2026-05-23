-- Web push notification subscriptions: one row per device/browser per user.
-- Staff opt in per device; sends go out via the service-role key.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- A staffer can see and manage only their own device subscriptions. Sending
-- happens server-side with the service-role key (bypasses RLS), so there is
-- intentionally no broad read policy.
create policy "push_subscriptions_own_select"
  on public.push_subscriptions for select
  using (user_id = auth.uid());

create policy "push_subscriptions_own_insert"
  on public.push_subscriptions for insert
  with check (user_id = auth.uid());

create policy "push_subscriptions_own_delete"
  on public.push_subscriptions for delete
  using (user_id = auth.uid());
