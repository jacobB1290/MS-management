/**
 * Generate src/server/demo/fixtures.ts from the assembled outreach-wave result.
 * Driven by sim-result.json (effective CRM state after the production guards)
 * + outreach-sim.ts (the threads). Produces 40 contacts, 50 messages, the
 * contact_summary rollup, form submissions for the QR arrivals, and an audit
 * log that shows the four auto-systems firing.
 *
 * Timestamps are emitted as `ago(minutes)` calls evaluated at module load, so
 * the demo always looks fresh AND the generated source is deterministic (the
 * minute offsets come from the corpus) — which lets sim-verify.ts byte-compare
 * a fresh generation against the committed file to catch drift.
 *
 * Run: npx tsx scripts/ai-eval/sim-gen-fixtures.ts
 */
import { readFileSync, writeFileSync } from "fs"
import { fileURLToPath } from "url"
import { outreachSim } from "./outreach-sim"

type Final = {
  id: string; name: string | null; phone: string; email: string | null; language: string; channel: string
  category: "general" | "prayer" | "question" | "outreach"; status: string | null; crisis: boolean
  tags: string[]; notes: string; optedOut: boolean; optOutSource: string | null
}

/** Sentinel for a timestamp; rendered as an `ago(min)` call in the output. */
const ago = (min: number) => ({ __ago: min })

export function generate(): string {
  const finals = JSON.parse(readFileSync(new URL("sim-result.json", import.meta.url), "utf8")) as Final[]
  const corpus = new Map(outreachSim.map((c) => [c.id, c]))

  const contacts: Record<string, unknown>[] = []
  const messages: Record<string, unknown>[] = []
  const contactSummary: Record<string, unknown>[] = []
  const formSubmissions: Record<string, unknown>[] = []
  const auditLog: Record<string, unknown>[] = []

  let demoIdx = 0
  const nextId = (p: string) => `${p}${++demoIdx}`

  for (const f of finals) {
    const c = corpus.get(f.id)!
    const lastMin = c.minsAgo
    const span = c.thread.length
    const createdMin = lastMin + span + 2
    const isForm = f.channel === "form"

    contacts.push({
      id: f.id,
      inbox_category: f.category,
      inbox_status: f.status,
      name: f.name,
      phone: f.phone,
      email: f.email,
      language: f.language,
      tags: f.tags,
      ai_tags: f.tags, // every sim tag was AI-applied (no human in the loop yet)
      sms_opted_out_at: f.optedOut ? ago(lastMin) : null,
      email_unsubscribed_at: null,
      is_member: f.id === "C23",
      consent_method: isForm ? "website_form" : "two_way_reply",
      consent_at: ago(createdMin),
      source: isForm ? "public_form" : "sms_inbound",
      notes: f.notes || null,
      created_at: ago(createdMin),
    })

    const n = c.thread.length
    let lastBody = ""
    let lastDir = "in"
    c.thread.forEach((m, i) => {
      const minAgo = lastMin + (n - 1 - i)
      const out = m.direction === "out"
      messages.push({
        id: nextId("m"),
        contact_id: f.id,
        direction: m.direction,
        body: m.body,
        media_url: null,
        channel: isForm && m.direction === "in" ? "form" : "sms",
        twilio_sid: out ? `SMsim_${f.id}_${i}_out` : isForm ? null : `SMsim_${f.id}_${i}`,
        status: out ? "delivered" : "received",
        error: null,
        campaign_id: null,
        sent_by: out ? "demo-admin" : null,
        num_segments: 1,
        price: out ? -0.0079 : null,
        price_unit: out ? "USD" : null,
        context: isForm && m.direction === "in" ? "transactional_event" : null,
        created_at: ago(minAgo),
      })
      lastBody = m.body
      lastDir = m.direction
    })

    contactSummary.push({
      id: f.id,
      name: f.name,
      phone: f.phone,
      email: f.email,
      tags: f.tags,
      sms_opted_out_at: f.optedOut ? ago(lastMin) : null,
      email_unsubscribed_at: null,
      is_member: f.id === "C23",
      inbox_category: f.category,
      inbox_status: f.status,
      last_message_at: ago(lastMin),
      last_message_body: lastBody,
      last_message_direction: lastDir,
      message_count: n,
      created_at: ago(createdMin),
    })

    if (isForm) {
      formSubmissions.push({ id: nextId("f"), contact_id: f.id, form_id: "website_connect", created_at: ago(createdMin) })
    }

    const base = lastMin
    auditLog.push({ id: nextId("a"), action: isForm ? "form.submitted" : "webhook.twilio.inbound", actor_user_id: null, target_table: isForm ? "form_submissions" : "messages", target_id: f.id, created_at: ago(base), ip: null })
    if (f.optedOut) auditLog.push({ id: nextId("a"), action: "contact.opt_out_sms", actor_user_id: null, target_table: "contacts", target_id: f.id, created_at: ago(base - 0.1), ip: null })
    if (f.category !== "general" || f.crisis) auditLog.push({ id: nextId("a"), action: "contact.inbox_triage", actor_user_id: null, target_table: "contacts", target_id: f.id, created_at: ago(base - 0.2), ip: null })
    if (f.tags.length) auditLog.push({ id: nextId("a"), action: "contact.auto_tag", actor_user_id: null, target_table: "contacts", target_id: f.id, created_at: ago(base - 0.3), ip: null })
    if (f.notes) auditLog.push({ id: nextId("a"), action: "contact.auto_note", actor_user_id: null, target_table: "contacts", target_id: f.id, created_at: ago(base - 0.4), ip: null })
  }

  // --- Demo-only: email threads for C05 (Jennifer Pace) ----------------------
  // The simulation itself is SMS/form. These few emails give the inbox's email
  // channel a real two-thread conversation so the threaded email view (subject
  // grouping, per-thread reply, the composer's target chip) renders in the demo
  // and the harness. C05 already has an email on file. Two subjects: an older
  // "Visiting this Sunday" reply chain and a newer "Children's ministry" thread
  // that ends on her question — the composer's default reply target.
  const c05Email = (id: string, direction: "in" | "out", subject: string, body: string, min: number) => ({
    id,
    contact_id: "C05",
    direction,
    body,
    body_html: null,
    subject,
    media_url: null,
    channel: "email",
    twilio_sid: null,
    provider_message_id: `demo-${id}@ms.church`,
    status: direction === "out" ? "delivered" : "received",
    error: null,
    campaign_id: null,
    sent_by: direction === "out" ? "demo-admin" : null,
    num_segments: null,
    price: null,
    price_unit: null,
    context: null,
    email_meta: null,
    created_at: ago(min),
  })
  const c05Emails = [
    c05Email("e1", "out", "Visiting this Sunday", "Hi Jennifer, so glad you're planning to visit. We've saved a few seats for your family at the 9am service this Sunday. Anything we can help with beforehand?", 21),
    c05Email("e2", "in", "Re: Visiting this Sunday", "Thank you so much! Is there parking near the entrance? We'll have both little ones with us.", 20),
    c05Email("e3", "out", "Re: Visiting this Sunday", "Yes, there's family parking right by the main doors, and someone from our welcome team will be there to greet you on your way in.", 19),
    c05Email("e4", "out", "Children's ministry", "One more thing for Sunday: our children's program runs during the 9am service, so the little ones are cared for while you settle in.", 16),
    c05Email("e5", "in", "Re: Children's ministry", "That's wonderful. What ages are the classes for? Ours are 3 and 5.", 13),
  ]
  messages.push(...c05Emails)
  const c05Summary = contactSummary.find((r) => r.id === "C05")
  if (c05Summary) {
    c05Summary.last_message_at = ago(13)
    c05Summary.last_message_body = "That's wonderful. What ages are the classes for? Ours are 3 and 5."
    c05Summary.last_message_direction = "in"
    c05Summary.last_message_channel = "email"
    c05Summary.message_count = (c05Summary.message_count as number) + c05Emails.length
  }

  // --- Demo-only: two finished promo campaigns (SMS + email) ------------------
  // The simulation is inbound triage; these give the campaigns area a real
  // delivery story — an Easter SMS blast (camp3, with per-recipient delivered/
  // failed/skipped outcomes and the matching outbound messages) and an Easter
  // email blast (camp4, a Brevo campaign with stats + a hard bounce). They power
  // the campaign list, the campaign detail funnel, and the email_events table.
  const EASTER_SMS = "Join us this Sunday for Easter at 9 or 11am, with childcare at both. Hope to see you!"
  // Outbound campaign messages, threaded onto the contacts that got the blast.
  const camp3Sent: Array<{ c: string; status: string }> = [
    { c: "C09", status: "delivered" },
    { c: "C15", status: "delivered" },
    { c: "C27", status: "delivered" },
    { c: "C36", status: "delivered" },
    { c: "C22", status: "sent" },
  ]
  const camp3Messages = camp3Sent.map(({ c, status }) => ({
    id: `mc3_${c.slice(1)}`,
    contact_id: c,
    direction: "out",
    body: EASTER_SMS,
    media_url: null,
    channel: "sms",
    twilio_sid: `SMcamp3_${c}`,
    status,
    error: null,
    campaign_id: "camp3",
    sent_by: "demo-admin",
    num_segments: 1,
    price: -0.0079,
    price_unit: "USD",
    context: "marketing_promotional",
    created_at: ago(2),
  }))
  // Insert the blast right after C01's opener so the demo's newest activity reads
  // naturally; the demo client sorts per-contact, so placement is cosmetic only.
  messages.splice(1, 0, ...camp3Messages)

  // Per-recipient outcomes for camp3 (the delivery funnel): the sent rows above,
  // plus carrier failures and consent/opt-out skips that the wall produced.
  const campaignRecipients: Record<string, unknown>[] = [
    ...camp3Sent.map(({ c, status }) => ({
      campaign_id: "camp3",
      contact_id: c,
      status,
      error: null,
      sent_at: ago(2),
      provider_id: `SMcamp3_${c}`,
      claimed_at: ago(2),
    })),
    { campaign_id: "camp3", contact_id: "C07", status: "failed", error: "30007 Carrier flagged the message as spam and blocked it", sent_at: ago(2), provider_id: null, claimed_at: ago(2) },
    { campaign_id: "camp3", contact_id: "C29", status: "failed", error: "30003 The handset was unreachable", sent_at: ago(2), provider_id: null, claimed_at: ago(2) },
    { campaign_id: "camp3", contact_id: "C02", status: "skipped_no_consent", error: null, sent_at: null, provider_id: null, claimed_at: null },
    { campaign_id: "camp3", contact_id: "C06", status: "skipped_no_consent", error: null, sent_at: null, provider_id: null, claimed_at: null },
    { campaign_id: "camp3", contact_id: "C13", status: "skipped_no_consent", error: null, sent_at: null, provider_id: null, claimed_at: null },
    { campaign_id: "camp3", contact_id: "C03", status: "skipped_opt_out", error: null, sent_at: null, provider_id: null, claimed_at: null },
    { campaign_id: "camp3", contact_id: "C04", status: "skipped_opt_out", error: null, sent_at: null, provider_id: null, claimed_at: null },
    { campaign_id: "camp4", contact_id: "C22", status: "sent", error: null, sent_at: ago(1), provider_id: "BREVO_camp4_22", claimed_at: ago(1) },
    { campaign_id: "camp4", contact_id: "C31", status: "sent", error: null, sent_at: ago(1), provider_id: "BREVO_camp4_31", claimed_at: ago(1) },
    { campaign_id: "camp4", contact_id: "C36", status: "sent", error: null, sent_at: ago(1), provider_id: "BREVO_camp4_36", claimed_at: ago(1) },
  ]

  // Demo events live in src/server/demo/events-fixtures.ts (merged in by the
  // demo client), kept out of this generated file which sim:verify byte-matches.

  auditLog.sort((a, b) => (a.created_at as { __ago: number }).__ago - (b.created_at as { __ago: number }).__ago)
  const auditRecent = auditLog.slice(0, 60)

  const campaigns = [
    { id: "camp1", name: "Neighborhood card drop — visitor follow-up", channel: "sms", status: "draft", body: "Thanks for reaching out after finding our card! We'd love to see you this Sunday at 9 or 11am. Reply with any questions.", media_url: null, sendgrid_template_id: null, email_subject: null, audience_filter: { category: "outreach" }, scheduled_at: null, started_at: null, completed_at: null, created_at: ago(30) },
    { id: "camp2", name: "Volunteer thank-you (draft)", channel: "email", status: "draft", body: null, media_url: null, sendgrid_template_id: "d-demo-template-001", email_subject: "Thank you for serving", audience_filter: { tags: ["volunteer"] }, scheduled_at: null, started_at: null, completed_at: null, created_at: ago(60 * 24) },
    { id: "camp3", name: "Easter service invite", channel: "sms", status: "done", body: EASTER_SMS, media_url: null, sendgrid_template_id: null, email_subject: null, audience_filter: { all: true }, scheduled_at: null, started_at: ago(2), completed_at: ago(2), created_at: ago(3) },
    { id: "camp4", name: "Easter email invite", channel: "email", status: "done", body: null, media_url: null, sendgrid_template_id: null, brevo_template_id: 7, email_subject: "Join us for Easter at Morning Star", audience_filter: { all: true }, scheduled_at: null, started_at: ago(1), completed_at: ago(1), created_at: ago(1), brevo_campaign_id: 4, brevo_list_id: 12, stats: { sent: 3, delivered: 2, uniqueViews: 1, viewed: 1, uniqueClicks: 0, clickers: 0, unsubscriptions: 0, hardBounces: 1, softBounces: 0 } },
    // Promo campaign linked to event E01 (Easter in the Park, in events-fixtures)
    // — drives the linked-campaign chip in the event detail's meta.
    { id: "camp5", name: "Easter in the Park — flyer promo", channel: "sms", status: "draft", body: "Easter in the Park — free games, food, and an egg hunt for all ages. Reserve your spot: https://ms.church/form", media_url: "https://lh3.googleusercontent.com/d/demo_drive_easter_flyer=w800", sendgrid_template_id: null, email_subject: null, audience_filter: { all: true }, event_id: "E01", scheduled_at: null, started_at: null, completed_at: null, created_at: ago(90) },
  ]
  const appUsers = [
    { user_id: "demo-admin", role: "admin", display_name: "Demo Staff", created_at: ago(60 * 24 * 60) },
    { user_id: "demo-member", role: "member", display_name: "Sam Rivera", created_at: ago(30 * 24 * 60) },
  ]
  const heartbeat = [{ id: 1, last_run_at: ago(3) }]
  const emailEvents = [
    { provider_event_id: "demo_bounce_c36", event_type: "hard_bounce", email: "aisha.b@example.com", payload: { camp_id: 4, email: "aisha.b@example.com" }, occurred_at: ago(1) },
  ]

  // Serialize rows, then turn each {"__ago":N} sentinel into an ago(N) call.
  const lines = (rows: unknown[]) =>
    rows
      .map((r) => "  " + JSON.stringify(r).replace(/\{"__ago":(-?\d+(?:\.\d+)?)\}/g, "ago($1)") + ",")
      .join("\n")

  return `import "server-only"
import type { StaffUser } from "@/server/auth"

/**
 * In-memory fixtures for demo mode. Everything here is fake — no real person,
 * phone, or email. Served by the demo Supabase client (src/server/demo/client.ts)
 * so the whole app renders without a database, provider, or any real PII.
 *
 * THIS DATASET IS A SIMULATION: a neighborhood card/flyer outreach wave (cards
 * carry the SMS number + a QR to the website form). It is 40 inbound
 * conversations / 50 messages, already run through the four background
 * auto-systems (opt-out, triage, tagging, notes) the way production would on
 * each inbound. GENERATED by scripts/ai-eval/sim-gen-fixtures.ts from
 * scripts/ai-eval/sim-result.json — run \`npm run sim:build\` to regenerate;
 * do not hand-edit (sim-verify.ts fails the build if this drifts).
 */

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

const MIN = 60_000
const now = Date.now()
/** Relative timestamp helper: \`min\` minutes before module load, as ISO. */
const ago = (min: number) => new Date(now - min * MIN).toISOString()

const contacts: Row[] = [
${lines(contacts)}
]

const messages: Row[] = [
${lines(messages)}
]

// contact_summary view — one row per contact with last-message rollup.
const contactSummary: Row[] = [
${lines(contactSummary)}
]

const campaigns: Row[] = [
${lines(campaigns)}
]

const campaignRecipients: Row[] = [
${lines(campaignRecipients)}
]

const appUsers: Row[] = [
${lines(appUsers)}
]

const formSubmissions: Row[] = [
${lines(formSubmissions)}
]

const auditLog: Row[] = [
${lines(auditRecent)}
]

const heartbeat: Row[] = [
${lines(heartbeat)}
]

const emailEvents: Row[] = [
${lines(emailEvents)}
]

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
  email_events: emailEvents,
}
`
}

function main() {
  const file = generate()
  writeFileSync(new URL("../../src/server/demo/fixtures.ts", import.meta.url), file)
  const m = file.match(/const contacts: Row\[\] = \[\n([\s\S]*?)\n\]/)
  const contactsCount = m ? m[1].split("\n").length : 0
  console.log(`Wrote src/server/demo/fixtures.ts (${contactsCount} contacts).`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
