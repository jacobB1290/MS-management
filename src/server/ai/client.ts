import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import { isDemoEnabled } from "@/server/demo"

/**
 * Anthropic / Claude integration lives entirely server-side. The API key never
 * reaches the browser — these helpers are only importable from route handlers
 * and other `server-only` modules.
 *
 * Two model tiers, picked per the cost/quality tradeoff of each task:
 *   - Haiku  → high-volume, cheap classification (auto-tagging).
 *   - Sonnet → quality-sensitive generation (reply drafting).
 */
export const AI_MODELS = {
  /** Cheap, fast — used for tag classification. */
  tagging: "claude-haiku-4-5-20251001",
  /** Higher quality — used for drafting/improving operator replies. */
  drafting: "claude-sonnet-4-6",
} as const

/**
 * Whether the Claude-backed features are usable in this deployment.
 *
 * Off when `ANTHROPIC_API_KEY` is unset (the affordance is hidden in the UI and
 * the endpoints 503 — never a crash), and off in demo mode (no real provider
 * calls on the throwaway fixture deployment). The UI reads this via
 * `/api/ai/status`; the endpoints re-check it as the wall.
 */
export function isAiEnabled(): boolean {
  return !isDemoEnabled() && Boolean(process.env.ANTHROPIC_API_KEY)
}

/**
 * Construct the Anthropic client. Throws if the key is missing — callers must
 * gate on `isAiEnabled()` first, so reaching here without a key is a bug, not a
 * user-facing path.
 */
export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Gate on isAiEnabled() before calling Claude.",
    )
  }
  return new Anthropic({ apiKey })
}
