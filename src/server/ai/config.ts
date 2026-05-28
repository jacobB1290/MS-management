import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import {
  normalizeConfig,
  resolveModelIn,
  AI_DEFAULTS,
  AI_FEATURES,
  AI_SETTINGS_KEY,
  type AiFeature,
  type AiFeatureConfig,
} from "@/lib/ai-models"
import { getModelFamilies } from "./models"

/**
 * DB-backed AI configuration: which Claude model (and reasoning effort) each
 * feature uses. Admins set this in Settings; it persists in `app_settings`
 * under the `ai_models` key, so changing models never needs a redeploy.
 *
 * Reads go through the service-role client (RLS-exempt) and are validated by
 * `normalizeConfig` with code defaults as the fallback — a malformed or missing
 * row can never crash a send path. All the pure metadata/validation lives in
 * the client-safe `@/lib/ai-models`, re-exported here for server callers.
 */
export * from "@/lib/ai-models"

/**
 * All feature configs (validated). One cheap settings read; safe to call per
 * request. Falls back to defaults on any read error so AI never hard-fails on
 * a settings hiccup.
 */
export async function getAiConfig(): Promise<Record<AiFeature, AiFeatureConfig>> {
  try {
    const admin = createSupabaseAdminClient()
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", AI_SETTINGS_KEY)
      .maybeSingle()
    // normalizeConfig validates shape + resolves via the offline fallback; then
    // re-resolve each model to the live latest of its class so a stored id like
    // `claude-opus-4-7` is served as `claude-opus-4-8` the moment the Models API
    // reports it — no Settings edit, no redeploy.
    const base = normalizeConfig(data?.value)
    const families = await getModelFamilies()
    const out = {} as Record<AiFeature, AiFeatureConfig>
    for (const f of AI_FEATURES) {
      out[f] = { ...base[f], model: resolveModelIn(base[f].model, families) ?? base[f].model }
    }
    return out
  } catch {
    return {
      drafting: AI_DEFAULTS.drafting,
      tagging: AI_DEFAULTS.tagging,
      triage: AI_DEFAULTS.triage,
      notes: AI_DEFAULTS.notes,
      optout: AI_DEFAULTS.optout,
    }
  }
}

/** Single-feature convenience for the AI call sites. */
export async function getFeatureConfig(feature: AiFeature): Promise<AiFeatureConfig> {
  return (await getAiConfig())[feature]
}
