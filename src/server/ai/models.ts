import "server-only"
import { createAnthropicClient, isAiEnabled } from "./client"
import { isDemoEnabled } from "@/server/demo"
import {
  AI_MODEL_FAMILIES,
  MODEL_CLASS_ORDER,
  modelClass,
  type AiModelClass,
  type AiModelFamilies,
} from "@/lib/ai-models"

/**
 * Live model discovery. Queries the Anthropic Models API and picks the NEWEST
 * version per class (opus / sonnet / haiku), so the picker and every call site
 * always run the latest available model with zero code changes — when Opus 4.8
 * supersedes 4.7, the next refresh adopts it automatically.
 *
 * Resolution flow: stored config holds a model id; `getAiConfig` maps it to its
 * class and looks up `families[class].latest` from here. So a contact whose
 * config still says `claude-opus-4-7` is silently served `claude-opus-4-8`.
 *
 * Caching: an in-process cache (per serverless instance) holds the result for
 * `TTL_MS`, so we hit the Models API at most once per instance per window — the
 * AI call sites read it for free. On no key / demo / any API error we return the
 * offline `AI_MODEL_FAMILIES` fallback (this is also what keeps the demo + visual
 * harness deterministic, since they never reach the network).
 */

const TTL_MS = 6 * 60 * 60 * 1000 // 6h on success
const ERROR_TTL_MS = 5 * 60 * 1000 // 5m on failure, so we retry soon without hammering

let cache: { families: AiModelFamilies; at: number; ttl: number } | null = null

export async function getModelFamilies(): Promise<AiModelFamilies> {
  // Demo + key-less deployments never call the network: keep them on the
  // deterministic offline fallback (the visual harness depends on this).
  if (isDemoEnabled() || !isAiEnabled() || !process.env.ANTHROPIC_API_KEY) {
    return AI_MODEL_FAMILIES
  }

  const now = Date.now()
  if (cache && now - cache.at < cache.ttl) return cache.families

  try {
    const families = await discover()
    cache = { families, at: now, ttl: TTL_MS }
    return families
  } catch {
    // Transient Models API failure — serve the last good result if we have one,
    // else the offline fallback, and back off before the next attempt.
    cache = { families: cache?.families ?? AI_MODEL_FAMILIES, at: now, ttl: ERROR_TTL_MS }
    return cache.families
  }
}

/** Single-feature-friendly: resolve one stored model id to the live latest. */
export async function resolveToLatest(model: string): Promise<string | null> {
  const cls = modelClass(model)
  if (!cls) return null
  return (await getModelFamilies())[cls].latest
}

interface ApiModel {
  id: string
  created_at?: string | null
}

/**
 * List every model, group by class, and keep the newest per class. "Newest" is
 * ranked by version tuple parsed from the id (major, minor, optional date
 * suffix) with `created_at` as a tiebreaker — robust to dated snapshots and to
 * the API omitting `created_at`. Classes the API doesn't return fall back.
 */
async function discover(): Promise<AiModelFamilies> {
  const client = createAnthropicClient()
  const best = new Map<AiModelClass, { model: ApiModel; rank: readonly number[] }>()

  // The SDK auto-paginates on iteration.
  for await (const m of client.models.list()) {
    const model = m as unknown as ApiModel
    const cls = modelClass(model.id)
    if (!cls) continue
    const rank = rankModel(model)
    const current = best.get(cls)
    if (!current || compareRank(rank, current.rank) > 0) best.set(cls, { model, rank })
  }

  const families = {} as AiModelFamilies
  for (const cls of MODEL_CLASS_ORDER) {
    const found = best.get(cls)
    families[cls] = found
      ? { latest: found.model.id, blurb: AI_MODEL_FAMILIES[cls].blurb }
      : AI_MODEL_FAMILIES[cls] // class not returned by the API — keep fallback
  }
  return families
}

/** [major, minor, dateSuffix, createdAtMs] — higher tuple = newer. */
function rankModel(m: ApiModel): readonly number[] {
  const v = m.id.match(/^claude-(?:opus|sonnet|haiku)-(\d+)-(\d+)(?:-(\d+))?/)
  const major = v ? Number(v[1]) : 0
  const minor = v ? Number(v[2]) : 0
  const date = v && v[3] ? Number(v[3]) : 0
  const created = m.created_at ? Date.parse(m.created_at) || 0 : 0
  return [major, minor, date, created]
}

function compareRank(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
