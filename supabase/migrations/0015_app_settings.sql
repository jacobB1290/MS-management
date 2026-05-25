-- app_settings: small key/value store for runtime-configurable app settings
-- that staff can change without a redeploy (e.g. which Claude model each AI
-- feature uses). Reads happen server-side with the service-role key (bypasses
-- RLS); writes go through an admin-gated route handler. Default-deny RLS still
-- applies as the wall.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.app_settings enable row level security;

-- Any signed-in staffer may read settings; only admins may change them.
create policy "app_settings_staff_read"
  on public.app_settings for select to authenticated
  using (app.is_staff());

create policy "app_settings_admin_write"
  on public.app_settings for all to authenticated
  using (app.is_admin()) with check (app.is_admin());
