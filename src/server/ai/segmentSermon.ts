import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { createAnthropicClient } from "@/server/ai/client"
import { getFeatureConfig, modelSupportsEffort, maxTokensWithThinking } from "@/server/ai/config"
import {
  SYSTEM_PROMPT,
  JSON_SCHEMA,
  ResultSchema,
  buildSegmentUserContent,
  finalizeSegmentation,
  type RawSegmentation,
  type SegmentResult,
} from "./segmentContract"

/**
 * Sermon segmentation: hand the model a full service transcript (timestamped)
 * and get back typed chapters, the classification, the song clips, and the
 * page metadata. The prompt, the JSON schema, and the boundary-repair pass all
 * live in the pure `./segmentContract` module so the live API path here and the
 * out-of-band runner (scripts/segment/pump.ts, where a Claude Code session
 * supplies the model output instead of the metered API) stay byte-identical.
 *
 * The contract's types are re-exported so existing importers
 * (`@/server/ai/segmentSermon`) keep resolving `SermonSegment`, `SermonFormat`,
 * etc. unchanged.
 */
export * from "./segmentContract"

// Safe ceiling for the segment call's max_tokens (output + adaptive-thinking
// headroom). Generous enough for a marathon service's chapter JSON plus deep
// thinking, and below any model's hard max-output so a high/max effort tier can
// never overshoot the limit and 400.
const SEGMENT_MAX_OUTPUT = 32000

/**
 * Segment a timestamped transcript via the Anthropic API. `durationSec` is used
 * to clamp/repair the model's boundaries into a gap-free, in-bounds cover.
 */
export async function segmentSermon(
  timestampedTranscript: string,
  durationSec: number,
  knownTopics: string[] = [],
): Promise<SegmentResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "disabled" }

  let parsed: RawSegmentation
  try {
    const config = await getFeatureConfig("segment")
    const supportsEffort = modelSupportsEffort(config.model)
    const client = createAnthropicClient()
    // Stream + finalMessage(): segment runs on the weekly cron with a large
    // max_tokens (adaptive thinking headroom + the chapter JSON) over a long
    // transcript. Anthropic's docs recommend streaming for high-max_tokens /
    // long-running calls — it sidesteps the SDK's 10-minute non-streaming
    // timeout guard and dropped idle connections. finalMessage() returns the
    // same assembled Message, so the parsing below is unchanged.
    const response = await client.messages
      .stream(
        {
          model: config.model,
          // Adaptive thinking so the Settings `effort` genuinely tunes reasoning
          // depth; max_tokens reserves thinking headroom so a thinking pass can't
          // truncate the chapter JSON. Haiku: none. Segmentation is the longest
          // output + deepest thinking of any feature: the old 4k base let thinking
          // on a long, unusual service eat the whole budget and truncate the JSON
          // (stop_reason: max_tokens, the New Year service failure). Generous base,
          // capped to SEGMENT_MAX_OUTPUT so a high/max tier can't overshoot.
          max_tokens: Math.min(SEGMENT_MAX_OUTPUT, maxTokensWithThinking(config.model, config.effort, 16384)),
          ...(supportsEffort ? { thinking: { type: "adaptive" as const } } : {}),
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          messages: [
            { role: "user", content: buildSegmentUserContent(durationSec, knownTopics, timestampedTranscript) },
          ],
          output_config: {
            format: { type: "json_schema", schema: JSON_SCHEMA },
            ...(supportsEffort ? { effort: config.effort } : {}),
          },
        },
        {
          // Background job on a 300s function, so it can wait through Anthropic's
          // transient capacity errors (529/500/429). Lift the default (2) so a
          // brief overload self-heals rather than needing a manual re-run.
          maxRetries: 5,
        },
      )
      .finalMessage()
    // A refusal (HTTP 200) or a truncation returns non-schema content; surface it
    // as a clean reason instead of a cryptic JSON parse error downstream.
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      return { ok: false, reason: "provider_failed", detail: `stop_reason:${response.stop_reason}` }
    }
    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
    parsed = ResultSchema.parse(JSON.parse(raw))
  } catch (err) {
    return {
      ok: false,
      reason: "provider_failed",
      detail: err instanceof Error ? err.message : String(err),
    }
  }

  return { ok: true, data: finalizeSegmentation(parsed, durationSec) }
}
