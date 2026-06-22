import "server-only"
import { z } from "zod"
import type Anthropic from "@anthropic-ai/sdk"
import { createAnthropicClient } from "@/server/ai/client"
import { getFeatureConfig, modelSupportsEffort } from "@/server/ai/config"

/**
 * Sermon segmentation: hand the model a full service transcript (timestamped)
 * and get back typed chapters — sermon, songs, scripture readings, prayer,
 * announcements — each with a title, a short summary, and any scripture refs,
 * plus an overall summary and SEO metadata for the public page.
 *
 * Same structured-output pattern as src/server/events/promote.ts (json_schema
 * via output_config.format, parsed with zod). The output is what ms.church
 * renders as the chaptered transcript + VideoObject schema, so the segment
 * boundaries (startSec/endSec) double as YouTube-style chapters.
 */

export const SEGMENT_TYPES = [
  "welcome",
  "worship", // congregational singing / music
  "scripture", // a read passage
  "prayer",
  "sermon", // the message / teaching
  "poem",
  "testimony",
  "offering",
  "announcement",
  "benediction",
  "other",
] as const
export type SegmentType = (typeof SEGMENT_TYPES)[number]

const SYSTEM_PROMPT = `You segment the transcript of a Sunday worship service at Morning Star Christian Church in Boise, Idaho into an ordered list of chapters.

You receive the full transcript with [mm:ss] or [h:mm:ss] timestamps at the start of caption lines. Captions may be auto-generated, so expect minor transcription errors, missing punctuation, and run-on text. Read for meaning, not literal spelling.

Produce:
- segments: an ordered, NON-overlapping, gap-free cover of the service from start to finish. Each segment has:
  - start_sec / end_sec: integers in seconds, taken from the nearest surrounding timestamps. The first segment starts at 0; each segment's end_sec equals the next segment's start_sec; the last ends at the final timestamp.
  - type: one of welcome, worship, scripture, prayer, sermon, poem, testimony, offering, announcement, benediction, other. Use "worship" for congregational singing/music, "sermon" for the main message/teaching, "scripture" for a passage being read aloud.
  - title: a short, specific, human title (e.g. "Opening worship", "Sermon: Mending the Broken", "Reading: Psalm 23"). Sentence case, no trailing period.
  - summary: 1-3 plain sentences on what happens in this chapter. For the sermon, capture the actual main point, not "the pastor preaches".
  - scripture_refs: array of normalized references mentioned or read (e.g. "John 3:16", "Psalm 23:1-6"). Empty array if none.
- summary: 2-4 sentences summarizing the whole service for a website visitor deciding whether to watch. Lead with the sermon's topic.
- seo: { description: a single ~155-character meta description for the service page; tags: 5-10 lowercase topical keywords (themes, book names, no the church name). }

Aim for roughly 4-12 segments — real chapters, not one per song line. Merge adjacent same-type material. Voice: warm, plain, accurate. Use curly apostrophes. Do not invent content that is not in the transcript; if the sermon topic is unclear, describe it generally rather than guessing specifics.`

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          start_sec: { type: "integer", minimum: 0 },
          end_sec: { type: "integer", minimum: 0 },
          type: { type: "string", enum: SEGMENT_TYPES as unknown as string[] },
          title: { type: "string" },
          summary: { type: "string" },
          scripture_refs: { type: "array", items: { type: "string" } },
        },
        required: ["start_sec", "end_sec", "type", "title", "summary", "scripture_refs"],
      },
    },
    summary: { type: "string" },
    seo: {
      type: "object",
      additionalProperties: false,
      properties: {
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["description", "tags"],
    },
  },
  required: ["segments", "summary", "seo"],
} as const

const SegmentSchema = z.object({
  start_sec: z.number().int().nonnegative(),
  end_sec: z.number().int().nonnegative(),
  type: z.enum(SEGMENT_TYPES),
  title: z.string(),
  summary: z.string(),
  scripture_refs: z.array(z.string()),
})

const ResultSchema = z.object({
  segments: z.array(SegmentSchema),
  summary: z.string(),
  seo: z.object({
    description: z.string(),
    tags: z.array(z.string()),
  }),
})

export type SermonSegment = {
  startSec: number
  endSec: number
  type: SegmentType
  title: string
  summary: string
  scriptureRefs: string[]
}

export type SermonSegmentation = {
  segments: SermonSegment[]
  summary: string
  seo: { description: string; tags: string[] }
}

export type SegmentResult =
  | { ok: true; data: SermonSegmentation }
  | { ok: false; reason: "disabled" | "provider_failed"; detail?: string }

// Caption transcripts are long; cap the input so a marathon service can't blow
// the context window. ~120k chars ≈ a multi-hour service of dense captions.
const MAX_TRANSCRIPT_CHARS = 120_000

/**
 * Segment a timestamped transcript. `durationSec` is used to clamp/repair the
 * model's boundaries so the cover is always gap-free and within the real length.
 */
export async function segmentSermon(
  timestampedTranscript: string,
  durationSec: number,
): Promise<SegmentResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "disabled" }

  const transcript =
    timestampedTranscript.length > MAX_TRANSCRIPT_CHARS
      ? timestampedTranscript.slice(0, MAX_TRANSCRIPT_CHARS)
      : timestampedTranscript

  let parsed: z.infer<typeof ResultSchema>
  try {
    const config = await getFeatureConfig("segment")
    const supportsEffort = modelSupportsEffort(config.model)
    const client = createAnthropicClient()
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: `Service length: about ${Math.round(durationSec)} seconds.\n\nTranscript:\n${transcript}`,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: JSON_SCHEMA },
        ...(supportsEffort ? { effort: config.effort } : {}),
      },
    })
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

  // Repair boundaries: sort, clamp into [0, duration], make gap-free, drop empties.
  const dur = Math.max(0, Math.round(durationSec))
  const sorted = [...parsed.segments].sort((a, b) => a.start_sec - b.start_sec)
  const cleaned: SermonSegment[] = []
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]
    const start = i === 0 ? 0 : cleaned[cleaned.length - 1].endSec
    const nextStart = sorted[i + 1]?.start_sec
    let end = Math.round(s.end_sec)
    if (nextStart !== undefined) end = Math.max(start, Math.round(nextStart))
    if (i === sorted.length - 1) end = dur > 0 ? dur : Math.max(start, end)
    end = Math.min(dur > 0 ? dur : end, Math.max(start, end))
    if (end <= start && i !== sorted.length - 1) continue // skip zero-length middles
    cleaned.push({
      startSec: start,
      endSec: end,
      type: s.type,
      title: s.title.trim() || "Chapter",
      summary: s.summary.trim(),
      scriptureRefs: s.scripture_refs.map((r) => r.trim()).filter(Boolean),
    })
  }

  return {
    ok: true,
    data: {
      segments: cleaned,
      summary: parsed.summary.trim(),
      seo: {
        description: parsed.seo.description.trim(),
        tags: parsed.seo.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
      },
    },
  }
}
