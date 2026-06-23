import "server-only"
import { z } from "zod"
import type Anthropic from "@anthropic-ai/sdk"
import { createAnthropicClient } from "@/server/ai/client"
import { getFeatureConfig, modelSupportsEffort, maxTokensWithThinking } from "@/server/ai/config"

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
  "sermon", // the message / teaching (one person preaching)
  "discussion", // the message as a 2-host discussion + congregational Q&A
  "poem",
  "testimony",
  "offering",
  "announcement",
  "benediction",
  "other",
] as const
export type SegmentType = (typeof SEGMENT_TYPES)[number]

const SYSTEM_PROMPT = `You segment the transcript of a Sunday worship service at Morning Star Christian Church in Boise, Idaho into an ordered list of chapters, and you classify the service.

You receive the full transcript with [mm:ss] or [h:mm:ss] timestamps at the start of caption lines. Captions may be auto-generated, so expect minor transcription errors, missing punctuation, and run-on text. Read for meaning, not literal spelling.

The week's MESSAGE is delivered in one of two formats: a sermon (one person teaching) or a discussion (two hosts talking it through together, sometimes taking congregational questions). Decide which.

Produce:
- format: "sermon" or "discussion" — how the main message was delivered this week.
- speakers: the people who gave the message, named only if the transcript states their names (the preaching pastor, or the two hosts). Use the form given (first name, or first + last). Empty array if no name is stated. Never guess a name.
- topics: EXACTLY ONE short, lowercase theme keyword for the message — the single best one (e.g. "grace", "fatherhood", "prayer", "the good shepherd"). Return it as a one-element array. REUSE an existing topic from the provided list whenever one fits; only coin a new topic when none capture it. A broad, durable theme — not the church name, not a bare Bible-book name. One tag only, so people can filter cleanly.
- segments: an ordered, NON-overlapping, gap-free cover of the service from start to finish. Each segment has:
  - start_sec / end_sec: integers in seconds, read from the [mm:ss] cues. The first segment starts at 0; each segment's end_sec equals the next segment's start_sec; the last ends at the final timestamp. Where exactly to place each boundary is the craft described at the end, not a snap to the nearest line.
  - type: one of welcome, worship, scripture, prayer, sermon, discussion, poem, testimony, offering, announcement, benediction, other. Use "worship" for congregational singing/music, "sermon" for a preached message, "discussion" for a two-host message, "scripture" for a passage being read aloud.
    The hardest discernment is singing versus teaching. Sung lyrics are often rich theology ("his wounds have paid my ransom"), and the captions render them as plain text, so a song can read like a sermon. Let the [music] / [singing] cues, repeated or rhyming lines, and the feel of the moment tell you when it is a song: worship and program songs are singing however scriptural the words, while the sermon is the one sustained stretch of a person plainly teaching. So do not fold a song, a reading, a prayer, or a worship leader's brief exhortation into the sermon, and do not call a song a sermon because its words are about Jesus.
  - title: a short, specific, human title (e.g. "Opening worship", "Sermon: Mending the Broken", "Reading: Psalm 23"). Sentence case, no trailing period.
  - summary: 1-3 plain sentences on what happens in this chapter. For the message, capture the actual main point, not "the pastor preaches".
  - scripture_refs: array of normalized references mentioned or read (e.g. "John 3:16", "Psalm 23:1-6"). Empty array if none.
- songs: every song this service, in order, each as { title, leader, kind, start_sec, end_sec }. List each song separately (never one "worship" block).
  - kind: "worship" or "program". "worship" is the regular congregational singing the whole church does together: there are usually about three worship songs in a service (an opening set, then a closing song), though not always. "program" is a song that is ANNOUNCED or introduced as a special or program item rather than part of that regular set: special music where one person or a group performs a song for the congregation (announced like "our brother Daniel will sing a song for us" or "[name] is going to come and sing"), or an occasional/program piece (a children's song, a holiday or program song). Most songs are "worship"; "program" songs are the announced exception. When unsure, choose "worship".
  - leader: for a "program" song, the performer's name exactly as stated (e.g., "Daniel"). For "worship", the worship leader's name ONLY if it is clearly stated, otherwise "" (worship songs usually name no one).
  - title: the song's name when it is stated or clearly recognizable from distinctive lyrics. If you are not confident which song it is, use a short honest descriptive title from a memorable line rather than guessing a specific hymn or worship-song name. Never fabricate a precise title you are unsure of.
  - topic: ONE short lowercase theme keyword for the song's subject (e.g. "praise", "grace", "the cross", "god's faithfulness", "surrender"). REUSE a topic from the list above whenever one fits, so songs and messages share a vocabulary; only coin a new one when none fit.
  - start_sec / end_sec: the span of the SUNG performance, because tapping a song on the website plays this clip and nothing else. The title and the bounds are the same performance, so whoever taps it lands on that song being sung, never on an announcement, a reading, the sermon, or another song. The boundary guidance below covers how to frame a song's start and end. Empty array only if there is genuinely no singing.
- summary: 2-4 sentences summarizing the whole service for a website visitor deciding whether to watch. Lead with the message's topic.
- seo: { description: a single ~155-character meta description for the service page; tags: 5-10 lowercase topical keywords (themes, book names, not the church name). }

Now the craft of the boundaries, which is the real work. This is a judgment call, not a mechanical one: the captions are sparse, imperfect, and sometimes wordless for long stretches (music, a quiet prayer), so do not just snap each boundary to the nearest caption line. Read the whole service, understand what each moment actually is, infer the real shape where the words run thin, and frame every start and end the way a thoughtful editor would, because these become the video's chapters and its playable song clips. Let the kind of moment guide the framing:
- A sermon or discussion should open right as the message lands its first real beat, its first true line of teaching, leaving the settling and shuffle before it to the prior chapter, and close as the teaching does.
- Readings, prayers, and welcomes begin and end where they plainly do.

SONG CLIP STARTS. A song clip begins where the instrumental intro begins, because the intro is part of the song. That point is almost always the moment the last person stops speaking before the music. This single anchor governs both worship and program songs: whoever speaks last before the singing (the announcer naming a congregational song, or a performer saying a few words before a special), the music begins as their voice settles, so place the start at the end of that last spoken line and let the intro run into the first sung word.

Do not anchor a start to the first sung word, and do not anchor it to the first "[music]" caption. Both arrive after the intro is already playing. The first sung word sits at the far end of the intro. An automatic captioner detects instrumental music several seconds after it truly begins, so the first "[music]" line is a late marker, not the onset. Anchoring to either one is what clips intros.

READING THE SPEECH BOUNDARY. A caption's timestamp marks where its words begin, not where they end. A line stamped at 1:41 may not finish until 1:45. So do not start the clip at the announcement's own timestamp, and do not start it at the next caption either. Estimate where the speaking actually ends from the length of what is said, and start there, adding no pause after it. The band or pianist begins promptly, so a gap left after the speech is intro wrongly handed to the previous chapter. This is the usual cause of a start that lands a second or two late. When unsure exactly where speech ends, bias a hair toward the speech, never toward the singing: a breath of an announcer's tail is easily forgiven, a clipped intro is the error a listener notices.

USING THE MUSIC CUES, WHEN PRESENT. A caption that is only "[music]", with no words, is firm evidence the instrumental is playing at that time. Two or more such lines before the first sung word mean a long intro, which means the music started well back, near where the speaking ended. Use these lines to confirm the gap between speech and singing is filled with music, so you keep all of it. Do not use them to mark where the music starts. If a "[music]" tag appears inside a spoken announcement ("our second [music] song"), the band started under the talking: for a congregational song you still begin at the end of the spoken words, since you cannot include the announcement, accepting that the couple of seconds of intro overlapping the speech are lost. That is the one place trimming a little intro is correct, because the alternative is broadcasting the announcement.

PROGRAM SONGS AND THE PERFORMER'S OWN WORDS. A special is introduced by naming a person to come and sing. Often that person, once up, says a few words of their own (a dedication, a greeting) before beginning. Those words are still talking, not music, so they belong in the lead-in, not the clip. Read past them to the performer's last spoken line, the one that hands off to the song ("I'll sing this now"), and start as that line ends. The music almost always begins immediately after it.

THE ONE EXCEPTION: A PERFORMER WHO DOES NOT SPEAK. Sometimes a performer is announced and simply walks up and sings, saying nothing. Then the wordless stretch after the announcer is a walk-up, and part of it may be silence rather than music, so you cannot anchor to the announcer without dragging dead air in. Here, lean on the "[music]" cues if any exist: begin a second or two before the first "[music]" line, since the instrumental started shortly before the captioner caught it. If there are no music cues at all, step back from the first sung word by a GENEROUS intro, not a stingy one, because prepared solos commonly open with fifteen to twenty seconds of piano, and bias early. If you can identify the song, let what you know of how it opens widen or narrow that estimate, as a nudge and never as the anchor. This step-back-from-the-vocals reasoning is only for this case, the announced performer who walks up in silence. It is not the default, and using it as the default is what clips intros elsewhere.

ENDS. Let a song end on its last note ringing out: the final "[music and singing]" or a trailing "[music]" line, just before the next voice (often "Praise God") or the next announcement. Give the end the same grace as the intro.

Genuine dead time (silence, off-mic shuffling, "can everyone hear me", people finding their seats, the milling of a meet-and-greet) should never be what a viewer lands on: tuck it into the end of the adjoining transition so each real chapter opens on its first real moment, with a natural beat of lead-in rather than a surgical cut. But music is never dead time. An instrumental intro or outro, or music under a prayer or communion, is the content itself, so never trim it as if it were silence.

Aim for roughly 4-12 segments: real chapters, not one per song line. Merge adjacent same-type material. Voice: warm, plain, accurate. Use curly apostrophes. Never use em dashes (or en dashes) in any text you write; phrase so they are not needed, using a colon to introduce, a period to split two thoughts into two sentences, a comma for a short aside, or parentheses for a genuine aside. Do not invent content that is not in the transcript; if the message topic is unclear, describe it generally rather than guessing specifics.`

// NOTE: Anthropic structured-output JSON Schema does NOT support numeric range
// keywords (minimum/maximum/multipleOf) or length keywords (minLength/maxLength).
// Non-negativity + the [0, duration] bounds are enforced by the boundary-repair
// pass below, so we omit them from the schema rather than have the API reject it.
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    // Limits like "1-3 topics" / "2 hosts" live in the prompt + repair pass, not
    // the schema — structured-output JSON Schema rejects minItems/maxItems.
    format: { type: "string", enum: ["sermon", "discussion"] },
    speakers: { type: "array", items: { type: "string" } },
    topics: { type: "array", items: { type: "string" } },
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          start_sec: { type: "integer" },
          end_sec: { type: "integer" },
          type: { type: "string", enum: SEGMENT_TYPES as unknown as string[] },
          title: { type: "string" },
          summary: { type: "string" },
          scripture_refs: { type: "array", items: { type: "string" } },
        },
        required: ["start_sec", "end_sec", "type", "title", "summary", "scripture_refs"],
      },
    },
    songs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          leader: { type: "string" },
          kind: { type: "string", enum: ["worship", "program"] },
          topic: { type: "string" },
          start_sec: { type: "integer" },
          end_sec: { type: "integer" },
        },
        required: ["title", "leader", "kind", "topic", "start_sec", "end_sec"],
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
  required: ["format", "speakers", "topics", "segments", "songs", "summary", "seo"],
} as const

const SegmentSchema = z.object({
  start_sec: z.number().int().nonnegative(),
  end_sec: z.number().int().nonnegative(),
  type: z.enum(SEGMENT_TYPES),
  title: z.string(),
  summary: z.string(),
  scripture_refs: z.array(z.string()),
})

const SongSchema = z.object({
  title: z.string(),
  leader: z.string(),
  kind: z.enum(["worship", "program"]),
  topic: z.string(),
  start_sec: z.number().int().nonnegative(),
  end_sec: z.number().int().nonnegative(),
})

const ResultSchema = z.object({
  format: z.enum(["sermon", "discussion"]),
  speakers: z.array(z.string()),
  topics: z.array(z.string()),
  segments: z.array(SegmentSchema),
  songs: z.array(SongSchema),
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

export type SongKind = "worship" | "program"

export type SermonSong = {
  title: string
  leader: string | null
  /** Regular congregational worship vs an announced program song. */
  kind: SongKind
  /** One theme keyword, shared with the message topic vocabulary. */
  topic: string | null
  startSec: number
  endSec: number
}

export type SermonFormat = "sermon" | "discussion"

export type SermonSegmentation = {
  format: SermonFormat
  speakers: string[]
  topics: string[]
  segments: SermonSegment[]
  songs: SermonSong[]
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
  knownTopics: string[] = [],
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
    // Stream + finalMessage(): segment runs on the weekly cron with a large
    // max_tokens (adaptive thinking headroom + the chapter JSON) over a long
    // transcript. Anthropic's docs recommend streaming for high-max_tokens /
    // long-running calls — it sidesteps the SDK's 10-minute non-streaming
    // timeout guard and dropped idle connections. finalMessage() returns the
    // same assembled Message, so the parsing below is unchanged.
    const response = await client.messages
      .stream({
        model: config.model,
        // Adaptive thinking so the Settings `effort` genuinely tunes reasoning
        // depth on this long-transcript segmentation; max_tokens reserves thinking
        // headroom so a thinking pass can't truncate the chapter JSON. Haiku: none.
        max_tokens: maxTokensWithThinking(config.model, config.effort, 4096),
        ...(supportsEffort ? { thinking: { type: "adaptive" as const } } : {}),
        system: [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        messages: [
          {
            role: "user",
            content: `Service length: about ${Math.round(durationSec)} seconds.\n\nExisting topics used across past services (reuse one when it fits; only coin a new topic when none do):\n${knownTopics.length ? knownTopics.join(", ") : "(none yet)"}\n\nTranscript:\n${transcript}`,
          },
        ],
        output_config: {
          format: { type: "json_schema", schema: JSON_SCHEMA },
          ...(supportsEffort ? { effort: config.effort } : {}),
        },
      }, {
        // Segmentation is a background job on a 300s function, so it can wait
        // through Anthropic's transient capacity errors (HTTP 529 overloaded_error,
        // 500s, 429s) instead of failing the run. The SDK retries these with
        // exponential backoff; lift the default (2) so a brief overload self-heals
        // rather than needing a manual re-run.
        maxRetries: 5,
      })
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

  // Songs: clamp into [0, duration], keep order, drop empty/zero-length ones.
  const songsRaw: SermonSong[] = [...parsed.songs]
    .sort((a, b) => a.start_sec - b.start_sec)
    .map((s) => {
      const start = Math.max(0, Math.round(s.start_sec))
      let end = Math.max(start, Math.round(s.end_sec))
      if (dur > 0) end = Math.min(dur, end)
      return {
        title: s.title.trim(),
        leader: s.leader.trim() || null,
        kind: s.kind,
        topic: s.topic.trim().toLowerCase() || null,
        startSec: dur > 0 ? Math.min(dur, start) : start,
        endSec: end,
      }
    })
    .filter((s) => Boolean(s.title) && s.endSec > s.startSec)

  // Safety net for a bad model run: a worship/program song is never sung DURING
  // the sermon. If the model mis-places a song's bounds onto the message (the
  // title can be right while the start/end drift, so the clip plays the sermon
  // under a song title), drop it. We test the MIDPOINT against the sermon /
  // discussion chapters (with a small margin so a song that merely abuts the
  // message edge is kept). Dropping is safe: songs recur, so the website still
  // shows it from another service, and a wrong clip is worse than a missing one.
  const messageSpans = cleaned
    .filter((c) => c.type === "sermon" || c.type === "discussion")
    .map((c) => [c.startSec, c.endSec] as const)
  const songs: SermonSong[] = songsRaw.filter((s) => {
    const mid = (s.startSec + s.endSec) / 2
    return !messageSpans.some(([a, b]) => mid > a + 5 && mid < b - 5)
  })

  return {
    ok: true,
    data: {
      format: parsed.format,
      speakers: Array.from(new Set(parsed.speakers.map((s) => s.trim()).filter(Boolean))),
      // One tag per item (hard rule): keep only the single best topic so the
      // public site filters cleanly. The model is asked for exactly one.
      topics: Array.from(
        new Set(parsed.topics.map((t) => t.trim().toLowerCase()).filter(Boolean)),
      ).slice(0, 1),
      segments: cleaned,
      songs,
      summary: parsed.summary.trim(),
      seo: {
        description: parsed.seo.description.trim(),
        tags: parsed.seo.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
      },
    },
  }
}
