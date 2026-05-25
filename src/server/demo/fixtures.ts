import "server-only"
import type { StaffUser } from "@/server/auth"

/**
 * In-memory fixtures for demo mode. Everything here is fake — no real person,
 * phone, or email. Served by the demo Supabase client (src/server/demo/client.ts)
 * so the whole app renders without a database, provider, or any real PII.
 */

const now = Date.now()
const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString()
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString()
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString()

export const DEMO_USER: StaffUser = {
  id: "demo-admin",
  email: "demo@morningstar.example",
  role: "admin",
  displayName: "Demo Staff",
}

/** Shape the Supabase auth client returns; only id/email are read downstream. */
export const DEMO_AUTH_USER = {
  id: DEMO_USER.id,
  email: DEMO_USER.email,
}

type Row = Record<string, unknown>

const contacts: Row[] = [
  {
    id: "c1",
    name: "Marcus Bell",
    phone: "+12085550148",
    email: "marcus.b@example.com",
    language: "en",
    tags: ["newcomer", "men's group"],
    sms_opted_out_at: null,
    email_unsubscribed_at: null,
    consent_method: "verbal",
    consent_at: daysAgo(12),
    source: "sms_inbound",
    notes: "Visited two Sundays in a row. Interested in the Wednesday study.",
    created_at: daysAgo(12),
  },
  {
    id: "c2",
    name: "Priya Nair",
    phone: "+12085550162",
    email: "priya.nair@example.com",
    language: "en",
    tags: ["volunteer", "worship"],
    sms_opted_out_at: null,
    email_unsubscribed_at: null,
    is_member: true,
    consent_method: "written",
    consent_at: daysAgo(40),
    source: "website_form",
    notes: null,
    created_at: daysAgo(40),
  },
  {
    id: "c3",
    name: "Elena Volkov",
    phone: "+12085550175",
    email: "elena.v@example.com",
    language: "ru",
    tags: ["small group"],
    sms_opted_out_at: null,
    email_unsubscribed_at: null,
    is_member: true,
    consent_method: "verbal",
    consent_at: daysAgo(6),
    source: "sms_inbound",
    notes: "Prefers Russian. Bringing a friend next week.",
    created_at: daysAgo(6),
  },
  {
    id: "c4",
    name: "James Okafor",
    phone: "+12085550199",
    email: null,
    language: "en",
    tags: ["newcomer"],
    sms_opted_out_at: hoursAgo(20),
    email_unsubscribed_at: null,
    consent_method: "verbal",
    consent_at: daysAgo(3),
    source: "sms_inbound",
    notes: null,
    created_at: daysAgo(3),
  },
  {
    id: "c5",
    name: null,
    phone: "+12085550113",
    email: null,
    language: "en",
    tags: [],
    sms_opted_out_at: null,
    email_unsubscribed_at: null,
    consent_method: "verbal",
    consent_at: hoursAgo(5),
    source: "sms_inbound",
    notes: null,
    created_at: hoursAgo(5),
  },
]

const messages: Row[] = [
  // c3 — awaiting reply (last message inbound)
  { id: "m1", contact_id: "c3", direction: "out", body: "Hi Elena! Glad you joined us Sunday. Small group meets Wednesday at 7pm. Want me to save you a seat?", media_url: null, channel: "sms", twilio_sid: "SM_demo1", status: "delivered", error: null, campaign_id: null, sent_by: "demo-admin", num_segments: 1, price: -0.0079, price_unit: "USD", created_at: hoursAgo(5) },
  { id: "m2", contact_id: "c3", direction: "in", body: "Yes please! And can I bring a friend?", media_url: null, channel: "sms", twilio_sid: "SM_demo2", status: "received", error: null, campaign_id: null, sent_by: null, num_segments: 1, price: null, price_unit: null, created_at: hoursAgo(4) },
  // c1 — replied (last outbound)
  { id: "m3", contact_id: "c1", direction: "in", body: "What time does the Wednesday study start?", media_url: null, channel: "sms", twilio_sid: "SM_demo3", status: "received", error: null, campaign_id: null, sent_by: null, num_segments: 1, price: null, price_unit: null, created_at: hoursAgo(28) },
  { id: "m4", contact_id: "c1", direction: "out", body: "7pm in the fellowship hall. Coffee from 6:45, so come early and meet a few folks.", media_url: null, channel: "sms", twilio_sid: "SM_demo4", status: "delivered", error: null, campaign_id: null, sent_by: "demo-admin", num_segments: 1, price: -0.0079, price_unit: "USD", created_at: hoursAgo(27) },
  // Campaign sends (Easter reminder) — give the campaign real settled cost.
  { id: "mc1", contact_id: "c1", direction: "out", body: "He is risen! Join us this Sunday at 9 & 11am. Bring a friend, childcare provided.", media_url: null, channel: "sms", twilio_sid: "SMcamp_a", status: "delivered", error: null, campaign_id: "camp1", sent_by: "demo-admin", num_segments: 1, price: -0.0079, price_unit: "USD", created_at: daysAgo(9) },
  { id: "mc2", contact_id: "c2", direction: "out", body: "He is risen! Join us this Sunday at 9 & 11am. Bring a friend, childcare provided.", media_url: null, channel: "sms", twilio_sid: "SMcamp_b", status: "delivered", error: null, campaign_id: "camp1", sent_by: "demo-admin", num_segments: 1, price: -0.0079, price_unit: "USD", created_at: daysAgo(9) },
  { id: "mc3", contact_id: "c3", direction: "out", body: "He is risen! Join us this Sunday at 9 & 11am. Bring a friend, childcare provided.", media_url: null, channel: "sms", twilio_sid: "SMcamp_c", status: "sent", error: null, campaign_id: "camp1", sent_by: "demo-admin", num_segments: 1, price: -0.0079, price_unit: "USD", created_at: daysAgo(9) },
  { id: "mc4", contact_id: "c5", direction: "out", body: "He is risen! Join us this Sunday at 9 & 11am. Bring a friend, childcare provided.", media_url: null, channel: "sms", twilio_sid: "SMcamp_d", status: "delivered", error: null, campaign_id: "camp1", sent_by: "demo-admin", num_segments: 1, price: -0.0079, price_unit: "USD", created_at: daysAgo(9) },
  // c2 — awaiting reply
  { id: "m5", contact_id: "c2", direction: "in", body: "Thank you for the warm welcome on Sunday 🙏", media_url: null, channel: "sms", twilio_sid: "SM_demo5", status: "received", error: null, campaign_id: null, sent_by: null, num_segments: 1, price: null, price_unit: null, created_at: hoursAgo(2) },
  // c4 — opted out, a failed send
  { id: "m6", contact_id: "c4", direction: "out", body: "Welcome! Here is the link to this week's bulletin.", media_url: null, channel: "sms", twilio_sid: "SM_demo6", status: "failed", error: "21610: opted out", campaign_id: null, sent_by: "demo-admin", num_segments: 1, price: null, price_unit: null, created_at: hoursAgo(20) },
  // c5 — no name, first inbound
  { id: "m7", contact_id: "c5", direction: "in", body: "Hi, is there a service this Sunday at 10?", media_url: null, channel: "sms", twilio_sid: "SM_demo7", status: "received", error: null, campaign_id: null, sent_by: null, num_segments: 1, price: null, price_unit: null, created_at: minsAgo(40) },
]

// contact_summary view — one row per contact with last-message rollup.
const contactSummary: Row[] = [
  { id: "c5", name: null, phone: "+12085550113", email: null, tags: [], sms_opted_out_at: null, email_unsubscribed_at: null, is_member: false, last_message_at: minsAgo(40), last_message_body: "Hi, is there a service this Sunday at 10?", last_message_direction: "in", message_count: 1, created_at: hoursAgo(5) },
  { id: "c2", name: "Priya Nair", phone: "+12085550162", email: "priya.nair@example.com", tags: ["volunteer", "worship"], sms_opted_out_at: null, email_unsubscribed_at: null, is_member: true, last_message_at: hoursAgo(2), last_message_body: "Thank you for the warm welcome on Sunday 🙏", last_message_direction: "in", message_count: 4, created_at: daysAgo(40) },
  { id: "c3", name: "Elena Volkov", phone: "+12085550175", email: "elena.v@example.com", tags: ["small group"], sms_opted_out_at: null, email_unsubscribed_at: null, is_member: true, last_message_at: hoursAgo(4), last_message_body: "Yes please! And can I bring a friend?", last_message_direction: "in", message_count: 2, created_at: daysAgo(6) },
  { id: "c1", name: "Marcus Bell", phone: "+12085550148", email: "marcus.b@example.com", tags: ["newcomer", "men's group"], sms_opted_out_at: null, email_unsubscribed_at: null, is_member: false, last_message_at: hoursAgo(27), last_message_body: "7pm in the fellowship hall. Coffee from 6:45 — come early and meet a few folks.", last_message_direction: "out", message_count: 2, created_at: daysAgo(12) },
  { id: "c4", name: "James Okafor", phone: "+12085550199", email: null, tags: ["newcomer"], sms_opted_out_at: hoursAgo(20), email_unsubscribed_at: null, is_member: false, last_message_at: hoursAgo(20), last_message_body: "Welcome! Here is the link to this week's bulletin.", last_message_direction: "out", message_count: 1, created_at: daysAgo(3) },
]

const campaigns: Row[] = [
  { id: "camp1", name: "Easter weekend reminder", channel: "sms", status: "done", body: "He is risen! Join us this Sunday at 9 & 11am. Bring a friend, childcare provided.", media_url: null, sendgrid_template_id: null, email_subject: null, audience_filter: { all: true }, scheduled_at: null, started_at: daysAgo(9), completed_at: daysAgo(9), created_at: daysAgo(10) },
  { id: "camp2", name: "Volunteer thank-you (draft)", channel: "email", status: "draft", body: null, media_url: null, sendgrid_template_id: "d-demo-template-001", email_subject: "Thank you for serving", audience_filter: { tags: ["volunteer"] }, scheduled_at: null, started_at: null, completed_at: null, created_at: daysAgo(1) },
]

const campaignRecipients: Row[] = [
  { campaign_id: "camp1", contact_id: "c1", status: "delivered" },
  { campaign_id: "camp1", contact_id: "c2", status: "delivered" },
  { campaign_id: "camp1", contact_id: "c3", status: "sent" },
  { campaign_id: "camp1", contact_id: "c4", status: "skipped_opt_out" },
  { campaign_id: "camp1", contact_id: "c5", status: "delivered" },
]

const appUsers: Row[] = [
  { user_id: "demo-admin", role: "admin", display_name: "Demo Staff", created_at: daysAgo(60) },
  { user_id: "demo-member", role: "member", display_name: "Sam Rivera", created_at: daysAgo(30) },
]

const formSubmissions: Row[] = [
  { id: "f1", contact_id: "c2", form_id: "website_connect", created_at: daysAgo(40) },
]

const auditLog: Row[] = [
  { id: "a1", action: "message.send", actor_user_id: "demo-admin", target_table: "messages", target_id: "m4", created_at: hoursAgo(27), ip: "203.0.113.10" },
  { id: "a2", action: "contact.opt_out", actor_user_id: "demo-admin", target_table: "contacts", target_id: "c4", created_at: hoursAgo(20), ip: "203.0.113.10" },
  { id: "a3", action: "campaign.start", actor_user_id: "demo-admin", target_table: "campaigns", target_id: "camp1", created_at: daysAgo(9), ip: "203.0.113.10" },
  { id: "a4", action: "user.invite", actor_user_id: "demo-admin", target_table: "app_users", target_id: "demo-member", created_at: daysAgo(30), ip: "203.0.113.10" },
]

const heartbeat: Row[] = [{ id: 1, last_run_at: minsAgo(3) }]

/** Tables/views the demo client can serve. Unknown tables resolve to []. */
export const DEMO_TABLES: Record<string, Row[]> = {
  contacts,
  contact_summary: contactSummary,
  messages,
  campaigns,
  campaign_recipients: campaignRecipients,
  app_users: appUsers,
  form_submissions: formSubmissions,
  audit_log: auditLog,
  heartbeat,
}
