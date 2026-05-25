import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import { isDemoEnabled } from "@/server/demo"

/**
 * Anthropic / Claude integration lives entirely server-side. The API key never
 * reaches the browser — these helpers are only importable from route handlers
 * and other `server-only` modules.
 *
 * Which model each feature uses is configured at runtime in Settings; see
 * `config.ts` for the choices, defaults, and the per-feature lookup.
 */

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
