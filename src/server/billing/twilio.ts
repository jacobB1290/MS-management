import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

/**
 * Twilio billing — read-side. Two concerns live here:
 *
 *  1. Per-message cost. Twilio attaches `price` to a Message ASYNCHRONOUSLY,
 *     after it reaches a final status. It is null at send time, so we can't
 *     know a campaign's cost the instant it sends. We fetch the real price
 *     from the Message resource once it settles (`captureMessagePrice`), and a
 *     reconciliation pass (`backfillMessagePrices`) sweeps up anything that
 *     lagged the status callback. Campaign cost = SUM(price) over its rows.
 *
 *  2. Account spend. The Usage Records + Balance APIs are Twilio's own billed
 *     numbers — the same ones on the invoice. `getSpendSummary` reads them
 *     through for the Settings view. Nothing here is estimated.
 *
 * Mirrors the raw-fetch + Basic-auth pattern in `sendSms.ts` — no SDK.
 */

const API_BASE = "https://api.twilio.com/2010-04-01"

type TwilioCreds = { accountSid: string; authToken: string }

function getTwilioCreds(): TwilioCreds | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) return null
  return { accountSid, authToken }
}

function authHeader(creds: TwilioCreds): string {
  return "Basic " + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")
}

// ---------------------------------------------------------------------------
// Per-message price
// ---------------------------------------------------------------------------

type MessagePrice = {
  price: number | null
  priceUnit: string | null
  numSegments: number | null
}

/**
 * Fetch one message's settled price from Twilio. Always fresh (no cache) — it
 * feeds DB writes. Returns null for mock-mode sids and unconfigured/failed
 * calls so callers can no-op safely.
 */
async function fetchMessagePrice(sid: string): Promise<MessagePrice | null> {
  if (!sid || sid.startsWith("MOCK_")) return null
  const creds = getTwilioCreds()
  if (!creds) return null
  try {
    const res = await fetch(
      `${API_BASE}/Accounts/${creds.accountSid}/Messages/${sid}.json`,
      { headers: { Authorization: authHeader(creds) }, cache: "no-store" },
    )
    if (!res.ok) return null
    const json = (await res.json()) as {
      price?: string | null
      price_unit?: string | null
      num_segments?: string | null
    }
    return {
      price: json.price != null ? Number(json.price) : null,
      priceUnit: json.price_unit ?? null,
      numSegments: json.num_segments != null ? Number(json.num_segments) : null,
    }
  } catch {
    return null
  }
}

/**
 * Fetch a message's price from Twilio and persist it on the `messages` row.
 * Idempotent and safe to call repeatedly: it only writes `price` once Twilio
 * actually has one. Returns true if a real price was written.
 */
export async function captureMessagePrice(sid: string): Promise<boolean> {
  const fetched = await fetchMessagePrice(sid)
  if (!fetched) return false

  const update: {
    price?: number
    price_unit?: string | null
    num_segments?: number | null
  } = {}
  if (fetched.price != null) {
    update.price = fetched.price
    update.price_unit = fetched.priceUnit
  }
  if (fetched.numSegments != null) update.num_segments = fetched.numSegments
  if (Object.keys(update).length === 0) return false

  const admin = createSupabaseAdminClient()
  await admin.from("messages").update(update).eq("twilio_sid", sid)
  return fetched.price != null
}

/** Statuses at which Twilio has handed off and a price can exist. */
export const PRICED_STATUSES = new Set([
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "read",
])

/**
 * Reconciliation: settle outbound messages whose price hadn't been finalized
 * when the status callback arrived (or whose callback we missed). Bounded so a
 * cron tick stays cheap; self-limiting because settled rows are excluded, so
 * steady state makes zero Twilio calls.
 */
export async function backfillMessagePrices(
  limit = 50,
): Promise<{ checked: number; settled: number }> {
  const admin = createSupabaseAdminClient()
  const sinceIso = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString()

  const { data } = await admin
    .from("messages")
    .select("twilio_sid")
    .is("price", null)
    .eq("direction", "out")
    .not("twilio_sid", "is", null)
    .in("status", Array.from(PRICED_STATUSES))
    .gte("created_at", sinceIso)
    .limit(limit)

  const rows = data ?? []
  let settled = 0
  for (const r of rows) {
    if (r.twilio_sid && (await captureMessagePrice(r.twilio_sid))) settled += 1
  }
  return { checked: rows.length, settled }
}

// ---------------------------------------------------------------------------
// Account spend (Usage Records + Balance)
// ---------------------------------------------------------------------------

export type SpendBreakdownRow = {
  category: string
  label: string
  count: number
  price: number
}

export type SpendSummary =
  | { configured: false }
  | { configured: true; ok: false; error: string }
  | {
      configured: true
      ok: true
      currency: string
      balance: number | null
      thisMonth: number
      lastMonth: number
      breakdown: SpendBreakdownRow[]
    }

/** Usage categories worth surfacing for a comms app, in display order. */
const BREAKDOWN_CATEGORIES: { category: string; label: string }[] = [
  { category: "sms-outbound", label: "Outbound SMS" },
  { category: "sms-inbound", label: "Inbound SMS" },
  { category: "mms-outbound", label: "Outbound MMS" },
  { category: "mms-inbound", label: "Inbound MMS" },
  { category: "phonenumbers", label: "Phone number" },
]

/**
 * Usage data changes slowly and the Settings view can be reloaded freely, so
 * cache each Twilio response for 5 minutes in Next's data cache. Price capture
 * does NOT use this path — it must stay fresh.
 */
async function twilioGetCached<T>(path: string, creds: TwilioCreds): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: authHeader(creds) },
    next: { revalidate: 300 },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Twilio ${res.status}: ${text.slice(0, 160)}`)
  }
  return (await res.json()) as T
}

type UsageRecordsResponse = {
  usage_records?: Array<{
    category?: string
    count?: string
    price?: string
  }>
}

/**
 * Total spend for a timeframe via the special `totalprice` category — Twilio's
 * own period total, which avoids the double-counting you'd get summing the
 * parent + child categories in the full list.
 */
async function fetchUsageTotal(
  creds: TwilioCreds,
  timeframe: "ThisMonth" | "LastMonth",
): Promise<number> {
  const json = await twilioGetCached<UsageRecordsResponse>(
    `/Accounts/${creds.accountSid}/Usage/Records/${timeframe}.json?Category=totalprice`,
    creds,
  )
  return (json.usage_records ?? []).reduce(
    (sum, r) => sum + (r.price ? Number(r.price) : 0),
    0,
  )
}

async function fetchBreakdown(creds: TwilioCreds): Promise<SpendBreakdownRow[]> {
  // Twilio returns ALL usage categories (500+ on a provisioned account), so a
  // small page silently drops the ones we want. Max page size pulls them in
  // one shot; the leaf categories we display sit well within it.
  const json = await twilioGetCached<UsageRecordsResponse>(
    `/Accounts/${creds.accountSid}/Usage/Records/ThisMonth.json?PageSize=1000`,
    creds,
  )
  const byCategory = new Map(
    (json.usage_records ?? []).map((r) => [r.category ?? "", r]),
  )
  return BREAKDOWN_CATEGORIES.map(({ category, label }) => {
    const r = byCategory.get(category)
    return {
      category,
      label,
      count: r?.count ? Number(r.count) : 0,
      price: r?.price ? Number(r.price) : 0,
    }
  })
}

/**
 * Read-through account spend for the Settings view. Returns a discriminated
 * result so the UI can render "not configured", "error", or live numbers
 * without throwing. Reflects ALL Twilio usage on the account, not just this
 * app's sends.
 */
export async function getSpendSummary(): Promise<SpendSummary> {
  const creds = getTwilioCreds()
  if (!creds) return { configured: false }

  try {
    const [balanceJson, thisMonth, lastMonth, breakdown] = await Promise.all([
      twilioGetCached<{ balance?: string; currency?: string }>(
        `/Accounts/${creds.accountSid}/Balance.json`,
        creds,
      ),
      fetchUsageTotal(creds, "ThisMonth"),
      fetchUsageTotal(creds, "LastMonth"),
      fetchBreakdown(creds),
    ])

    return {
      configured: true,
      ok: true,
      currency: balanceJson.currency?.toUpperCase() ?? "USD",
      balance: balanceJson.balance != null ? Number(balanceJson.balance) : null,
      thisMonth,
      lastMonth,
      breakdown,
    }
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: e instanceof Error ? e.message : "Failed to load Twilio usage",
    }
  }
}

/** Format a number as currency. Shared by the spend view and campaign cost. */
export function formatMoney(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: amount !== 0 && Math.abs(amount) < 0.01 ? 4 : 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}
