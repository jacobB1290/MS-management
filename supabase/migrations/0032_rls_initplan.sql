-- 0032_rls_initplan.sql
-- Every policy called app.is_staff() / app.is_admin() / auth.uid() bare.
-- Postgres may then evaluate the helper per ROW on large scans; wrapping the
-- call in a scalar subquery turns it into an InitPlan evaluated once per
-- statement (the standard Supabase RLS performance guidance). Semantics are
-- identical — the helpers are STABLE and depend only on the request JWT.
-- This matters most on the hot paths: contact_summary scans, message-thread
-- reads, and realtime change filtering all pass through these policies.

alter policy app_settings_admin_write on public.app_settings
  using ((select app.is_admin())) with check ((select app.is_admin()));
alter policy app_settings_staff_read on public.app_settings
  using ((select app.is_staff()));

alter policy app_users_admin_write on public.app_users
  using ((select app.is_admin())) with check ((select app.is_admin()));
alter policy app_users_select_self_or_admin on public.app_users
  using (user_id = (select auth.uid()) or (select app.is_admin()));

alter policy audit_log_admin_read on public.audit_log
  using ((select app.is_admin()));

alter policy campaign_recipients_staff_read on public.campaign_recipients
  using ((select app.is_staff()));

alter policy campaigns_admin_delete on public.campaigns
  using ((select app.is_admin()));
alter policy campaigns_staff_insert on public.campaigns
  with check ((select app.is_staff()));
alter policy campaigns_staff_read on public.campaigns
  using ((select app.is_staff()));
alter policy campaigns_staff_update on public.campaigns
  using ((select app.is_staff())) with check ((select app.is_staff()));

alter policy church_knowledge_staff_read on public.church_knowledge
  using ((select app.is_staff()));

alter policy contacts_admin_delete on public.contacts
  using ((select app.is_admin()));
alter policy contacts_staff_insert on public.contacts
  with check ((select app.is_staff()));
alter policy contacts_staff_read on public.contacts
  using ((select app.is_staff()));
alter policy contacts_staff_update on public.contacts
  using ((select app.is_staff())) with check ((select app.is_staff()));

alter policy email_events_staff_read on public.email_events
  using ((select app.is_staff()));

alter policy events_admin_delete on public.events
  using ((select app.is_admin()));
alter policy events_staff_insert on public.events
  with check ((select app.is_staff()));
alter policy events_staff_read on public.events
  using ((select app.is_staff()));
alter policy events_staff_update on public.events
  using ((select app.is_staff())) with check ((select app.is_staff()));

alter policy form_submissions_admin_read on public.form_submissions
  using ((select app.is_admin()));

alter policy heartbeat_staff_read on public.heartbeat
  using ((select app.is_staff()));

alter policy messages_staff_read on public.messages
  using ((select app.is_staff()));

alter policy push_subscriptions_own_delete on public.push_subscriptions
  using (user_id = (select auth.uid()));
alter policy push_subscriptions_own_insert on public.push_subscriptions
  with check (user_id = (select auth.uid()));
alter policy push_subscriptions_own_select on public.push_subscriptions
  using (user_id = (select auth.uid()));
