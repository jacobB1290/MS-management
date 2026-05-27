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

  auditLog.sort((a, b) => (a.created_at as { __ago: number }).__ago - (b.created_at as { __ago: number }).__ago)
  const auditRecent = auditLog.slice(0, 60)

  const campaigns = [
    { id: "camp1", name: "Neighborhood card drop — visitor follow-up", channel: "sms", status: "draft", body: "Thanks for reaching out after finding our card! We'd love to see you this Sunday at 9 or 11am. Reply with any questions.", media_url: null, sendgrid_template_id: null, email_subject: null, audience_filter: { category: "outreach" }, scheduled_at: null, started_at: null, completed_at: null, created_at: ago(30) },
    { id: "camp2", name: "Volunteer thank-you (draft)", channel: "email", status: "draft", body: null, media_url: null, sendgrid_template_id: "d-demo-template-001", email_subject: "Thank you for serving", audience_filter: { tags: ["volunteer"] }, scheduled_at: null, started_at: null, completed_at: null, created_at: ago(60 * 24) },
  ]
  const campaignRecipients: Record<string, unknown>[] = []
  const appUsers = [
    { user_id: "demo-admin", role: "admin", display_name: "Demo Staff", created_at: ago(60 * 24 * 60) },
    { user_id: "demo-member", role: "member", display_name: "Sam Rivera", created_at: ago(30 * 24 * 60) },
  ]
  const heartbeat = [{ id: 1, last_run_at: ago(3) }]

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
