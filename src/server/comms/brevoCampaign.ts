import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { Json } from "@/lib/database.types"
import {
  brevoConfigured,
  brevoReplyTo,
  createEmailCampaign,
  createFolder,
  createList,
  getEmailCampaign,
  getProcess,
  importContacts,
  sendCampaignNow,
} from "./brevo"

/**
 * Email-campaign (blast) dispatch via Brevo's MARKETING lane — never the
 * transactional API (sending promotional content transactionally risks account
 * suspension). The flow hands a LIST to Brevo rather than looping a send per
 * recipient, which keeps us within the free tier's ~100 req/hour management cap
 * and the 300/day send budget:
 *
 *   1. ensure a per-campaign Brevo list
 *   2. bulk-import the consent-cleared audience into it (one async call)
 *   3. create the campaign against the list + sendNow
 *
 * It is IDEMPOTENT and re-runnable: state lives on the campaign row
 * (brevo_list_id / brevo_campaign_id / brevo_sync), so a cron tick or a repeat
 * "Send" click resumes exactly where it left off. A short bounded wait on the
 * import lets a small congregation list finish in a single call; anything
 * larger returns 'syncing' and is finished by the next tick.
 */

const DEFAULT_DAILY_CAP = 300

function dailyCap(): number {
  const n = Number(process.env.BREVO_DAILY_SEND_CAP)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP
}

export type DispatchResult =
  | { ok: true; phase: "sent" | "syncing" | "empty"; count: number }
  | {
      ok: false
      reason: "over_daily_cap" | "provider_failed" | "not_email" | "no_template"
      detail?: string
      cap?: number
      count?: number
    }

type Admin = ReturnType<typeof createSupabaseAdminClient>

export async function advanceBrevoEmailCampaign(campaignId: string): Promise<DispatchResult> {
  const admin = createSupabaseAdminClient()
  const { data: c, error } = await admin
    .from("campaigns")
    .select(
      "id, channel, name, email_subject, brevo_template_id, brevo_list_id, brevo_campaign_id, brevo_sync, status",
    )
    .eq("id", campaignId)
    .maybeSingle()
  if (error || !c) return { ok: false, reason: "provider_failed", detail: "campaign not found" }
  if (c.channel !== "email") return { ok: false, reason: "not_email" }

  // Already handed to Brevo — done (stats refresh is a separate path).
  if (c.brevo_campaign_id) return { ok: true, phase: "sent", count: 0 }

  // Eligible audience = recipients staged 'queued' by the start route (already
  // run through the consent classifier: has an email + not unsubscribed).
  const eligible = await loadQueuedEmails(admin, campaignId)
  if (eligible.length === 0) {
    await finalize(admin, campaignId, { status: "done" })
    return { ok: true, phase: "empty", count: 0 }
  }

  // Free-tier guard: refuse rather than blow the shared 300/day cap or send to a
  // silently truncated audience. The operator narrows the audience or upgrades.
  const cap = dailyCap()
  if (eligible.length > cap) {
    await admin
      .from("campaigns")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        brevo_sync: { error: "over_daily_cap", count: eligible.length, cap },
      })
      .eq("id", campaignId)
    return { ok: false, reason: "over_daily_cap", count: eligible.length, cap }
  }

  // Mock mode (no Brevo key): mark the queued recipients sent and finish, so the
  // campaigns flow + harness work without a provisioned account.
  if (!brevoConfigured()) {
    await markQueuedSent(admin, campaignId, "MOCK_BREVO")
    await finalize(admin, campaignId, { status: "done" })
    return { ok: true, phase: "sent", count: eligible.length }
  }

  if (!c.brevo_template_id) return { ok: false, reason: "no_template" }

  // 1) Ensure the list + fire the one-shot bulk import of the audience.
  let listId = c.brevo_list_id
  const sync = (c.brevo_sync ?? {}) as unknown as { import_process_id?: number }
  if (!listId) {
    const folderId = await resolveFolderId()
    if (folderId === null) {
      return { ok: false, reason: "provider_failed", detail: "could not resolve a Brevo folder" }
    }
    const list = await createList({ name: `crm-${campaignId}`, folderId })
    if (!list.ok) return recordProviderFailure(admin, campaignId, "create Brevo list", list.status, list.error)
    listId = list.data.id
    const imp = await importContacts({
      listIds: [listId],
      jsonBody: eligible.map((e) => ({
        email: e.email,
        attributes: e.name ? { FIRSTNAME: e.name } : undefined,
      })),
    })
    if (!imp.ok) return recordProviderFailure(admin, campaignId, "import contacts", imp.status, imp.error)
    sync.import_process_id = imp.data.processId
    await admin
      .from("campaigns")
      .update({ brevo_list_id: listId, brevo_sync: { import_process_id: imp.data.processId } })
      .eq("id", campaignId)
  }
  if (listId == null) return { ok: false, reason: "provider_failed", detail: "no Brevo list" }

  // 2) Wait (briefly) for the import to finish. Small lists complete in seconds;
  // otherwise return 'syncing' and let the next tick / Send click resume.
  if (sync.import_process_id && !(await waitForImport(sync.import_process_id))) {
    return { ok: true, phase: "syncing", count: eligible.length }
  }

  // 3) Create the campaign against the list and send it now. Our own scheduler
  // already gated the timing (scheduled → sending), so we always sendNow here.
  const created = await createEmailCampaign({
    name: c.name,
    subject: c.email_subject ?? c.name,
    templateId: c.brevo_template_id,
    listIds: [listId],
    replyTo: brevoReplyTo(),
  })
  if (!created.ok)
    return recordProviderFailure(admin, campaignId, "create email campaign", created.status, created.error)

  const sent = await sendCampaignNow(created.data.id)
  if (!sent.ok) {
    // Persist the id so a retry doesn't recreate the campaign on Brevo.
    await admin.from("campaigns").update({ brevo_campaign_id: created.data.id }).eq("id", campaignId)
    return recordProviderFailure(admin, campaignId, "send campaign", sent.status, sent.error)
  }

  await markQueuedSent(admin, campaignId, String(created.data.id))
  await finalize(admin, campaignId, { status: "done", brevoCampaignId: created.data.id })
  return { ok: true, phase: "sent", count: eligible.length }
}

/** On-demand refresh of a sent blast's stats, for the campaign detail page. */
export async function refreshBrevoCampaignStats(campaignId: string): Promise<void> {
  if (!brevoConfigured()) return
  const admin = createSupabaseAdminClient()
  const { data: c } = await admin
    .from("campaigns")
    .select("brevo_campaign_id")
    .eq("id", campaignId)
    .maybeSingle()
  if (!c?.brevo_campaign_id) return
  const res = await getEmailCampaign(Number(c.brevo_campaign_id))
  if (!res.ok) return
  const stats = res.data.statistics?.globalStats
  if (stats) {
    await admin
      .from("campaigns")
      .update({ stats: stats as unknown as Json })
      .eq("id", campaignId)
  }
}

// --- helpers ----------------------------------------------------------------

async function loadQueuedEmails(
  admin: Admin,
  campaignId: string,
): Promise<{ contactId: string; email: string; name: string | null }[]> {
  const { data: recs } = await admin
    .from("campaign_recipients")
    .select("contact_id")
    .eq("campaign_id", campaignId)
    .eq("status", "queued")
  const ids = (recs ?? []).map((r) => r.contact_id)
  if (ids.length === 0) return []

  const { data: contacts } = await admin
    .from("contacts")
    .select("id, email, name")
    .in("id", ids)
  const out: { contactId: string; email: string; name: string | null }[] = []
  for (const c of contacts ?? []) {
    if (c.email) out.push({ contactId: c.id, email: c.email, name: c.name })
  }
  return out
}

async function markQueuedSent(admin: Admin, campaignId: string, providerId: string): Promise<void> {
  await admin
    .from("campaign_recipients")
    .update({ status: "sent", provider_id: providerId, sent_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .eq("status", "queued")
}

async function finalize(
  admin: Admin,
  campaignId: string,
  args: { status: "done"; brevoCampaignId?: number },
): Promise<void> {
  await admin
    .from("campaigns")
    .update({
      status: args.status,
      completed_at: new Date().toISOString(),
      brevo_sync: null,
      ...(args.brevoCampaignId ? { brevo_campaign_id: args.brevoCampaignId } : {}),
    })
    .eq("id", campaignId)
}

/**
 * Surface a Brevo provider failure instead of swallowing it. Before, a rejected
 * createEmailCampaign / send left the campaign 'sending' with 'queued' recipients
 * and recorded nothing, so the cron retried it every minute forever — invisible
 * to the operator ("Queued and not sending") and hammering Brevo's ~100/hr
 * management cap.
 *
 * A 4xx is OUR request (unverified campaign sender, bad template, empty list):
 * terminal — mark the campaign failed, stamp WHY in brevo_sync (the campaign page
 * can show it), and fail the queued recipients. A 5xx / network error is
 * transient — keep 'sending' so the next tick retries, but still record the last
 * error so it is never an invisible stall.
 */
async function recordProviderFailure(
  admin: Admin,
  campaignId: string,
  step: string,
  status: number,
  detail: string,
): Promise<DispatchResult> {
  const message = `${step}: ${detail}`
  console.error(`[brevoCampaign] ${campaignId} ${step} failed (status ${status}): ${detail}`)
  const terminal = status >= 400 && status < 500
  if (terminal) {
    await admin
      .from("campaigns")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        brevo_sync: { error: "provider_failed", step, status, detail } as unknown as Json,
      })
      .eq("id", campaignId)
    await admin
      .from("campaign_recipients")
      .update({ status: "failed", error: message })
      .eq("campaign_id", campaignId)
      .eq("status", "queued")
  } else {
    await admin
      .from("campaigns")
      .update({
        brevo_sync: { error: "provider_failed", step, status, detail, transient: true } as unknown as Json,
      })
      .eq("id", campaignId)
  }
  return { ok: false, reason: "provider_failed", detail: message }
}

async function resolveFolderId(): Promise<number | null> {
  const env = Number(process.env.BREVO_LIST_FOLDER_ID)
  if (Number.isFinite(env) && env > 0) return env
  const folder = await createFolder("MS Church CRM")
  return folder.ok ? folder.data.id : null
}

async function waitForImport(processId: number): Promise<boolean> {
  for (let i = 0; i < 4; i++) {
    const res = await getProcess(processId)
    if (res.ok && (res.data.status ?? "").toLowerCase() === "completed") return true
    await new Promise((r) => setTimeout(r, 1500))
  }
  const res = await getProcess(processId)
  return res.ok && (res.data.status ?? "").toLowerCase() === "completed"
}
