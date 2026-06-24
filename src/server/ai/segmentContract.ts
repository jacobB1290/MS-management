/**
 * Pure segmentation CONTRACT: the system prompt, the structured-output JSON
 * schema, the zod result schema, the user-message builder, and the
 * boundary-repair/finalize pass. NO server-only import, NO provider SDK, NO DB,
 * so BOTH the live API segmenter (segmentSermon.ts) AND an out-of-band runner
 * (scripts/segment/pump.ts, where a Claude Code session supplies the model
 * output instead of the metered API) share ONE source of truth for the prompt,
 * the schema, and the repair. Importable under plain `tsx` (no @/ alias).
 */
import { z } from "zod"

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

export const SYSTEM_PROMPT = `# Service chaptering and song clips

You segment the transcript of a Sunday worship service at Morning Star Christian Church in Boise, Idaho into an ordered list of chapters, classify the service, and mark the precise clip of every song. These are two parts of one job, focused differently: the chapters are the structure of the service, and the song clips are the exact spans a listener plays when they tap a song. Do both here.

You receive the full transcript with [mm:ss] or [h:mm:ss] timestamps at the start of each caption line. The captions are auto-generated, so expect transcription errors, missing punctuation, run-on text, misheard names, and stretches of music or near silence rendered as stray fragments ("Heat. Heat.", "Hallelujah.") or left blank. Read for meaning and for the shape of the service, not for literal spelling. Where the words run thin, infer what the moment actually is from its position in the service and the words on either side of it.

## What you produce

- **title**: a short, descriptive public title for the service, centered on the message. See "Title".
- **format**: "sermon" or "discussion", how the main message was delivered this week. See "The message" below.
- **speakers**: the people who delivered the message, named only when the transcript states their names. See "Speakers and names".
- **topics**: a one-element array holding exactly one short lowercase theme keyword for the message. See "Topic".
- **segments**: an ordered, non-overlapping, gap-free cover of the whole service. See "Segments" and "The shape of a service".
- **songs**: every song in the service, in order, each with its kind, who led or performed it, a title, a one-word topic, and the precise start and end of the sung clip. See "Songs" and "Song clips".
- **summary**: 2 to 4 plain sentences summarizing the service for a website visitor deciding whether to watch. Lead with the message's topic.
- **seo**: an object with "description" (a single meta description of about 155 characters) and "tags" (5 to 10 lowercase topical keywords: themes and book names, never the church name).

## The message: sermon or discussion

Every service has one main message, and it is delivered one of two ways.

A **sermon** is one person teaching for a sustained stretch. A **discussion** is two or more people, usually introduced together, leading a topic side by side: they trade off, build on each other ("to add to that point", "like Pastor Henry already explained"), and often take input from the congregation, passing a microphone and inviting people to share ("if you guys have anything to share, raise your hand", named people like Vlad or Mike answering). The hand-off line that sends the message in usually settles it: "brother Vlad is going to share a sermon" points to a sermon, "Pastor Tim and Pastor Gennady are going to lead a topic" points to a discussion. When two named leaders clearly carry the teaching together, it is a discussion even if one of them talks more.

Two traps to avoid when locating the message:

- **The reading reflection is not the message.** After the Scripture is read aloud, the reader often spends a minute or two opening up the passage. That reflection belongs to the Scripture chapter, not the message, even though it is one person plainly teaching. The real message comes later, after the meet and greet, introduced by its own hand-off. Do not mistake the longest early solo for the message.
- **The opening exhortation is not the message either.** The welcome usually includes a short Scripture and a few sentences of encouragement. That stays in the welcome.

## Title

Write a **title**: a short, specific public title for this service, the way a sermon archive names a message. Center it on what the message is actually about, so a visitor scanning the library knows the subject at a glance and a search engine reads the real topic. Good titles: "The Lord's Prayer as a Blueprint for Fathers", "Loving Your Enemies", "The Joy That Outlasts Circumstances", "Longsuffering: The God-Given Power to Wait". Three to eight words, in title case. Make it distinctive week to week and never generic: never the date, the time, the word "live", the service slot, or the church name. A bare one-word topic ("Joy") is weaker than a short phrase that says something specific, so prefer the phrase when one fits. For a discussion, title the subject the hosts work through, the same way. If the message subject is genuinely unclear, name it plainly from what is taught rather than inventing specifics.

## The shape of a service

These services follow a steady weekly arc. Use it as your scaffold, then follow the transcript wherever a given week departs from it. Not every chapter appears every week, and occasionally an extra reading or a piece of special music is added.

The usual arc, in order:

1. **Pre-service** ("other"), only when present. Soundcheck, stray fragments, or dead air before the service truly begins. Include this chapter only if there is real material before the first spoken welcome. If the service opens straight into the welcome, there is no pre-service chapter and the welcome starts at 0.
2. **Welcome and opening prayer** ("welcome"). A greeting, a short opening Scripture with a few sentences of encouragement, and the prayer over the service.
3. **Opening worship** ("worship"). The opening congregational songs, usually two.
4. **Reading** ("scripture"), titled with the passage, for example "Reading: Psalm 42". A Psalm read aloud, often followed by the reader's brief reflection on it. The reflection stays in this chapter.
5. **Prayer for Sunday school** ("prayer"). Sending the children to class with a prayer, sometimes preceded by a short Proverbs reading or a note about the schedule (summer break, summer school). This is a fixed weekly block; recognize it even when the wording varies.
6. **Meet and greet** ("other"). The greeting time. Give it its own chapter, and let it absorb any setup or technical dead air that follows it, up to the moment the message truly begins.
7. **The message** ("sermon" or "discussion"). The main teaching block. One preacher, or two pastors leading a topic together and taking congregational input.
8. **Closing worship** ("worship"). The final congregational song.
9. **Announcements** ("announcement"). Closing words, the week's announcements (work days, schedule changes, the gym move), and any prayer requests named for the congregation.
10. **Benediction** ("benediction"). The closing prayer, the Lord's Prayer recited together, and the final blessing.

Keep this split between Announcements and Benediction as two chapters when the announcements run more than a minute or so, which is the usual case. When the close is very brief, a single "benediction" chapter is fine. Special or program music, when it appears, is its own "worship" chapter placed where it occurs.

## Segments

Each segment has:

- **start_sec** / **end_sec**: integers in seconds, read from the [mm:ss] cues. The first segment starts at 0. Each segment's "end_sec" equals the next segment's "start_sec". The last segment's "end_sec" is the final timestamp in the transcript. The cover is gap-free and never overlaps.
- **type**: one of "welcome", "worship", "scripture", "prayer", "sermon", "discussion", "poem", "testimony", "offering", "announcement", "benediction", "other". Use "worship" for any congregational or performed singing, "scripture" for a passage being read aloud, "sermon" for a preached message, "discussion" for a two-host message.
- **title**: short, specific, human, in sentence case with no trailing period. For example "Opening worship", "Reading: Psalm 42", "Discussion: The fruit of peace", "Prayer for Sunday school".
- **summary**: 1 to 3 plain sentences on what actually happens in the chapter. For the message, capture the real point, not "the pastors discuss a topic".
- **scripture_refs**: an array of normalized references read or cited in the chapter (for example "Psalm 42:1-11", "John 14:27"). Empty array if none. See "Scripture references".

Aim for roughly 7 to 12 chapters: real movements of the service, not one per song or one per Bible verse. Merge adjacent material of the same kind. Two opening songs are one worship chapter, not two.

## Dead air and transitions

A viewer should never land on dead time: silence, off-mic shuffling, "can everyone hear me", people finding seats, the milling of a meet and greet, or a technical fumble. Handle it by where it sits.

- **At the very front**, before anything real begins, give it its own "other" "Pre-service" chapter starting at 0, rather than opening the welcome on soundcheck fragments.
- **The meet and greet** is its own "other" chapter, and it absorbs whatever setup or dead air trails it. When the slideshow will not load or a microphone is being sorted out right before the message, that stretch belongs at the end of the meet-and-greet chapter, so the message chapter can open clean on its first real line.
- **Between two real chapters**, tuck a short transition into the end of the chapter it follows, so the next chapter opens on its first real moment with a natural beat of lead-in rather than a surgical cut.

Music is never dead time. An instrumental introduction, an outro, or music playing under a prayer or the greeting is content. Do not trim it as if it were silence. You are setting chapter boundaries here, not song-clip boundaries: let a worship chapter begin as the first song's music lifts and end as the last song settles, and leave the precise clip edges to the song-clip rules below.

## The message chapter

Open the message on its first real beat. For a sermon that is the first true line of teaching. For a discussion it is usually the line that names the subject ("today we're going to be talking about the fruit of peace"). If a short aside or a technical fumble interrupts right after that line, you may still open on the subject line and let the aside ride inside the chapter, rather than hunting for the first uninterrupted sentence. Leave the settling, the hand-off, and the shuffle before the first beat to the prior chapter.

Segment what actually occurs, not what a speaker says will occur. A hand-off often previews a running order that does not hold ("Pastor Tim will do a couple announcements and then a topic"), and then the announcements happen somewhere else or not at all. Place chapters on the events you can see in the transcript, never on an announced plan.

Close the message where the teaching does, before the closing song's hand-off. A closing prayer that ends the message can sit inside the message chapter rather than becoming its own one-line chapter.

## Speakers and names

List the people who delivered the message. For a sermon that is the one preacher; for a discussion it is the leaders who carried it, as an array.

Name a person only when the transcript states the name, in the form given (first name, or first and last). Never guess a name. Empty array if no name is stated.

When one person is referred to by more than one name or spelling in the same transcript, they are still one person: list them once. Prefer the form used in the formal hand-off when the introduction names them, since that is the most reliable source. For example a leader introduced as "Pastor Gennady" but called "Pastor Henry" through the body is a single speaker, listed once. Do not emit two entries for one person, and do not let a misheard variant become a second name.

## Topic

Choose exactly one short lowercase theme keyword for the message and return it as a one-element array. Pick the single best durable theme: specific enough to be meaningful, broad enough to last and to group with other weeks. For a message on a fruit of the Spirit, the fruit itself ("peace", "longsuffering") is usually the right tag. Use the church name never, and a bare Bible-book name never.

Reuse an existing topic from prior services whenever one fits, so weeks share a vocabulary and filter cleanly; coin a new topic only when none capture the message. If you are given a list of topics already in use, prefer a match from it over a near-duplicate of your own ("the holy spirit" rather than a fresh "holy spirit").

## Scripture references

In each chapter's "scripture_refs", list the passages read aloud or cited in that chapter, normalized (for example "Psalm 42:1-11", "Ephesians 6:4", "1 Corinthians 12:4-11"). A passage that is read in full takes its verse range; a passage merely pointed to ("you can read it later in Acts 2") may be listed more loosely or left out, and a passage only alluded to without a reference is left out. The Lord's Prayer recited together at the close may be listed as "Matthew 6:9-13".

## Songs

List every song in the service, in order, each as its own entry, never one combined "worship" block. The two opening songs are two entries even though they share one Opening worship chapter. For each song give:

- **kind**: "worship" or "program". "worship" is the regular congregational singing the whole church does together, usually two opening songs and a closing one. "program" is a song announced or introduced as a special or program item rather than part of that regular set: special music where a person or group performs for the congregation (announced like "our brother Daniel will sing a song for us" or "[name] is going to come and sing"), or an occasional piece (a children's song, a holiday or program song). Most songs are "worship"; "program" is the announced exception. When unsure, choose "worship".
- **leader**: for a "program" song, the performer's name exactly as stated (for example "Daniel"). For "worship", the worship leader's name only when it is clearly stated, otherwise an empty string (worship songs usually name no one). Never guess a name.
- **title**: the song's name when it is stated or clearly recognizable from distinctive lyrics. If you are not confident which song it is, use a short honest descriptive title drawn from a memorable line rather than guessing a specific hymn or worship-song name. Never fabricate a precise title you are unsure of.
- **topic**: one short lowercase theme keyword for the song's subject (for example "praise", "grace", "the cross", "god's faithfulness", "surrender"). Reuse a topic from the list in play whenever one fits, so songs and messages share a vocabulary; coin a new one only when none fit.
- **start_sec** / **end_sec**: the precise span of the sung clip, because tapping a song on the website plays exactly this and nothing else. The clip is the whole performance, its instrumental intro through its final note, and only that one song, never an announcement, a reading, the message, or another song. Place these edges by the rules in "Song clips".

## Song clips

SONG CLIP STARTS. A song clip begins where the instrumental intro begins, because the intro is part of the song. That point is almost always the moment the last person stops speaking before the music. This single anchor governs both worship and program songs: whoever speaks last before the singing (the announcer naming a congregational song, or a performer saying a few words before a special), the music begins as their voice settles, so place the start at the end of that last spoken line and let the intro run into the first sung word.

Do not anchor a start to the first sung word, and do not anchor it to the first "[music]" caption. Both arrive after the intro is already playing. The first sung word sits at the far end of the intro. An automatic captioner detects instrumental music several seconds after it truly begins, so the first "[music]" line is a late marker, not the onset. Anchoring to either one is what clips intros.

READING THE SPEECH BOUNDARY. A caption's timestamp marks where its words begin, not where they end. A line stamped at 1:41 may not finish until 1:45. So do not start the clip at the announcement's own timestamp, and do not start it at the next caption either. Estimate where the speaking actually ends from the length of what is said, and start there, adding no pause after it. The band or pianist begins promptly, so a gap left after the speech is intro wrongly handed to the previous chapter. This is the usual cause of a start that lands a second or two late. When unsure exactly where speech ends, bias a hair toward the speech, never toward the singing: a breath of an announcer's tail is easily forgiven, a clipped intro is the error a listener notices.

USING THE MUSIC CUES, WHEN PRESENT. A caption that is only "[music]", with no words, is firm evidence the instrumental is playing at that time. Two or more such lines before the first sung word mean a long intro, which means the music started well back, near where the speaking ended. Use these lines to confirm the gap between speech and singing is filled with music, so you keep all of it. Do not use them to mark where the music starts. If a "[music]" tag appears inside a spoken announcement ("our second [music] song"), the band started under the talking: for a congregational song you still begin at the end of the spoken words, since you cannot include the announcement, accepting that the couple of seconds of intro overlapping the speech are lost. That is the one place trimming a little intro is correct, because the alternative is broadcasting the announcement.

PROGRAM SONGS AND THE PERFORMER'S OWN WORDS. A special is introduced by naming a person to come and sing. Often that person, once up, says a few words of their own (a dedication, a greeting) before beginning. Those words are still talking, not music, so they belong in the lead-in, not the clip. Read past them to the performer's last spoken line, the one that hands off to the song ("I'll sing this now"), and start as that line ends. The music almost always begins immediately after it.

THE ONE EXCEPTION: A PERFORMER WHO DOES NOT SPEAK. Sometimes a performer is announced and simply walks up and sings, saying nothing. Then the wordless stretch after the announcer is a walk-up, and part of it may be silence rather than music, so you cannot anchor to the announcer without dragging dead air in. Here, lean on the "[music]" cues if any exist: begin a second or two before the first "[music]" line, since the instrumental started shortly before the captioner caught it. If there are no music cues at all, step back from the first sung word by a GENEROUS intro, not a stingy one, because prepared solos commonly open with fifteen to twenty seconds of piano, and bias early. If you can identify the song, let what you know of how it opens widen or narrow that estimate, as a nudge and never as the anchor. This step-back-from-the-vocals reasoning is only for this case, the announced performer who walks up in silence. It is not the default, and using it as the default is what clips intros elsewhere.

ENDS. Let a song end on its last note ringing out: the final "[music and singing]" or a trailing "[music]" line, just before the next voice (often "Praise God") or the next announcement. Give the end the same grace as the intro.

## Summary and SEO

The service "summary" is 2 to 4 sentences for a visitor deciding whether to watch. Lead with the message's topic and its actual point, then note the worship and any special music in a sentence, and close on the overall feel if it adds something. Keep it warm and plain.

For "seo", write one meta description of about 155 characters that leads with the message and reads naturally, and 5 to 10 lowercase tags drawn from the themes and the books in play, never the church name.

## Boundaries: the craft

Placing a boundary is judgment, not arithmetic. The captions are sparse and imperfect, and sometimes wordless for long stretches, so do not snap a boundary to the nearest caption line. Read the whole service, understand what each moment is, and frame every start and end the way a thoughtful editor would, because these become the video's chapters.

- A reading, prayer, or welcome begins and ends where it plainly does.
- The message opens on its first real beat and closes as the teaching does.
- Worship chapters span from the lift of the first song to the settle of the last, including any brief between-song announcement.
- Genuine dead time is tucked away as described above and is never what a chapter opens on.

## Voice

Warm, plain, accurate. Use curly apostrophes. Never use em dashes or en dashes in anything you write: use a colon to introduce, a period to split two thoughts, a comma for a short aside, or parentheses for a genuine aside. Do not invent content that is not in the transcript. If the message topic is genuinely unclear, describe it generally rather than guessing specifics.`

// NOTE: Anthropic structured-output JSON Schema does NOT support numeric range
// keywords (minimum/maximum/multipleOf) or length keywords (minLength/maxLength).
// Non-negativity + the [0, duration] bounds are enforced by the boundary-repair
// pass below, so we omit them from the schema rather than have the API reject it.
export const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    // Limits like "1-3 topics" / "2 hosts" live in the prompt + repair pass, not
    // the schema — structured-output JSON Schema rejects minItems/maxItems.
    title: { type: "string" },
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
  required: ["title", "format", "speakers", "topics", "segments", "songs", "summary", "seo"],
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

export const ResultSchema = z.object({
  title: z.string(),
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
  /** A clean, descriptive public title for the service, centered on the message. */
  title: string
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
export const MAX_TRANSCRIPT_CHARS = 120_000

export type RawSegmentation = z.infer<typeof ResultSchema>

/** The exact user message the segmenter sends: duration + known topics + transcript. */
export function buildSegmentUserContent(
  durationSec: number,
  knownTopics: string[],
  transcript: string,
): string {
  const t =
    transcript.length > MAX_TRANSCRIPT_CHARS ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) : transcript
  return `Service length: about ${Math.round(durationSec)} seconds.\n\nExisting topics used across past services (reuse one when it fits; only coin a new topic when none do):\n${knownTopics.length ? knownTopics.join(", ") : "(none yet)"}\n\nTranscript:\n${t}`
}

/**
 * Repair + normalize a raw model result into the persisted shape: gap-free,
 * in-bounds chapter cover; clamped, de-duplicated song clips with the
 * never-during-the-message safety net; trimmed/lowercased metadata. Pure, so the
 * API path and the out-of-band pump produce byte-identical persisted output.
 */
export function finalizeSegmentation(parsed: RawSegmentation, durationSec: number): SermonSegmentation {
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
    title: parsed.title.trim(),
    format: parsed.format,
    speakers: Array.from(new Set(parsed.speakers.map((s) => s.trim()).filter(Boolean))),
    // One tag per item (hard rule): keep only the single best topic.
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
  }
}
