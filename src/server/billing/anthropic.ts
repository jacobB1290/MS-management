import "server-only"
import { modelLabel } from "@/lib/ai-models"

/**
 * Anthropic billing — read-side, for the Settings view. Pulls the organization
 * Cost Report (real billed USD) and Messages Usage Report (real token counts)
 * from the Admin API. Nothing here is estimated.
 *
 * Requires an Admin API key (`ANTHROPIC_ADMIN_KEY`, an `sk-ant-admin…` key) —
 * distinct from the model key (`ANTHROPIC_API_KEY`) used for inference. Without
 * it the panel renders a "not configured" note.
 *
 * Note: Anthropic exposes no credit-balance endpoint (only cost + usage), so
 * unlike the Twilio panel there is intentionally no balance figure.
 *
 * Mirrors the raw-fetch + cached-read pattern in `billing/twilio.ts` — no SDK.
 */

const API_BASE = "https://api.anthropic.com/v1/organizations"
const ANTHROPIC_VERSION = "2023-06-01"

function getAdminKey(): string | null {
  return process.env.ANTHROPIC_ADMIN_KEY || null
}

export type AiModelSpend = {
  model: string
  label: string
  inputTokens: number
  outputTokens: number
  cost: number
}

export type AiSpendSummary =
  | { configured: false }
  | { configured: true; ok: false; error: string }
  | {
      configured: true
      ok: true
      currency: string
      thisMonth: number
      lastMonth: number
      models: AiModelSpend[]
    }

// --- Admin API response shapes (only the fields we read) -------------------

type CostResult = {
  amount?: string
  currency?: string
  model?: string | null
}
type CostReport = { data?: Array<{ results?: CostResult[] }> }

type UsageResult = {
  model?: string | null
  uncached_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: {
    ephemeral_1h_input_tokens?: number
    ephemeral_5m_input_tokens?: number
  }
  output_tokens?: number
}
type UsageReport = { data?: Array<{ results?: UsageResult[] }> }

/** Build a query string, serializing arrays as repeated `key[]=value`. */
function qs(params: Record<string, string | string[]>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      for (const item of v) parts.push(`${encodeURIComponent(k + "[]")}=${encodeURIComponent(item)}`)
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    }
  }
  return parts.join("&")
}

/** Usage data changes slowly and Settings can be reloaded freely, so cache each
 *  Admin API response for 5 minutes in Next's data cache. */
async function adminGetCached<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "X-Api-Key": key, "anthropic-version": ANTHROPIC_VERSION },
    next: { revalidate: 300 },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 160)}`)
  }
  return (await res.json()) as T
}

/** First-of-month at 00:00:00 UTC for the month containing `d`. */
function monthStartUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

/** Cost amounts come back in the smallest currency unit (cents) as a decimal
 *  string. Convert to whole-currency units. */
function centsToUnits(amount: string | undefined): number {
  const n = amount != null ? Number(amount) : 0
  return Number.isFinite(n) ? n / 100 : 0
}

function sumCost(report: CostReport): number {
  let total = 0
  for (const bucket of report.data ?? []) {
    for (const r of bucket.results ?? []) total += centsToUnits(r.amount)
  }
  return total
}

/**
 * Live AI spend for the Settings view. Discriminated result so the UI can show
 * "not configured", "error", or real numbers without throwing. Reflects ALL
 * usage on the Anthropic organization, not just this app's calls.
 */
export async function getAiSpendSummary(): Promise<AiSpendSummary> {
  const key = getAdminKey()
  if (!key) return { configured: false }

  const now = new Date()
  const thisStart = monthStartUtc(now).toISOString()
  const lastStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString()

  try {
    const [costThis, costLast, usageThis] = await Promise.all([
      // group_by=description is what populates the per-result `model`,
      // `token_type`, etc. (the Cost API leaves them null when not grouped by
      // description). The cost report only accepts workspace_id/description as
      // group_by — do NOT switch this to "model" (the API rejects it).
      adminGetCached<CostReport>(
        `/cost_report?${qs({ starting_at: thisStart, bucket_width: "1d", limit: "31", group_by: ["description"] })}`,
        key,
      ),
      adminGetCached<CostReport>(
        `/cost_report?${qs({ starting_at: lastStart, ending_at: thisStart, bucket_width: "1d", limit: "31" })}`,
        key,
      ),
      adminGetCached<UsageReport>(
        `/usage_report/messages?${qs({ starting_at: thisStart, bucket_width: "1d", limit: "31", group_by: ["model"] })}`,
        key,
      ),
    ])

    // Per-model cost (this month) from the description-grouped cost report.
    const costByModel = new Map<string, number>()
    let currency = "USD"
    for (const bucket of costThis.data ?? []) {
      for (const r of bucket.results ?? []) {
        if (r.currency) currency = r.currency
        if (!r.model) continue
        costByModel.set(r.model, (costByModel.get(r.model) ?? 0) + centsToUnits(r.amount))
      }
    }

    // Per-model token counts (this month) from the model-grouped usage report.
    const usageByModel = new Map<string, { input: number; output: number }>()
    for (const bucket of usageThis.data ?? []) {
      for (const r of bucket.results ?? []) {
        if (!r.model) continue
        const input =
          (r.uncached_input_tokens ?? 0) +
          (r.cache_read_input_tokens ?? 0) +
          (r.cache_creation?.ephemeral_1h_input_tokens ?? 0) +
          (r.cache_creation?.ephemeral_5m_input_tokens ?? 0)
        const prev = usageByModel.get(r.model) ?? { input: 0, output: 0 }
        usageByModel.set(r.model, { input: prev.input + input, output: prev.output + (r.output_tokens ?? 0) })
      }
    }

    const modelIds = new Set<string>([...costByModel.keys(), ...usageByModel.keys()])
    const models: AiModelSpend[] = Array.from(modelIds)
      .map((model) => {
        const tokens = usageByModel.get(model) ?? { input: 0, output: 0 }
        return {
          model,
          label: modelLabel(model),
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          cost: costByModel.get(model) ?? 0,
        }
      })
      .sort((a, b) => b.cost - a.cost)

    return {
      configured: true,
      ok: true,
      currency,
      thisMonth: sumCost(costThis),
      lastMonth: sumCost(costLast),
      models,
    }
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: e instanceof Error ? e.message : "Failed to load Anthropic usage",
    }
  }
}

/** Compact token count for display (e.g. 12.3K, 4.5M). */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
