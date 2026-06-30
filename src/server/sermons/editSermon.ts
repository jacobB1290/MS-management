import "server-only"
import { z } from "zod"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import type { Json, Tables } from "@/lib/database.types"
import { SEGMENT_TYPES, type SegmentType } from "@/server/ai/segmentContract"
import { slugify } from "./segmentApply"

/**
 * The manual service editor's write path. The pipeline produces a service; this
 * lets a human fix anything the model left blank or got slightly wrong — every
 * field the public site shows, plus the chapter + song arrays (timestamps,
 * add/remove). It is the editor's counterpart to applySegmentation, but for
 * deliberate human edits rather than a model run.
 *
 * Integrity without fighting intent: on save we sort chapters/songs by start,
 * clamp them into [0, duration], and drop zero/negative-length rows — but we do
 * NOT auto-fill gaps the way finalizeSegmentation does. A gap the operator left
 * is the operator's call; the editor flags it, the server respects it.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>
type Sermon = Tables<"sermons">

const SegmentInput = z.object({
  startSec: z.number(),
  endSec: z.number(),
  type: z.string(),
  title: z.string(),
  summary: z.string(),
  // Per-message attribution; tolerant of payloads from before the field existed.
  speakers: z.array(z.string()).default([]),
  scriptureRefs: z.array(z.string()),
  // Optional in-chapter sub-sections; tolerant default so an editor that doesn't
  // touch them still validates, and a save preserves whatever was there.
  children: z
    .array(z.object({ startSec: z.number(), endSec: z.number(), title: z.string() }))
    .default([]),
})

const SongInput = z.object({
  title: z.string(),
  leader: z.string().nullable(),
  kind: z.string(),
  topic: z.string().nullable(),
  startSec: z.number(),
  endSec: z.number(),
})

/** What the editor PATCHes — the full editable surface of a service. */
export const EditSermonSchema = z.object({
  generatedTitle: z.string(),
  format: z.string(),
  publishedAt: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  durationSec: z.number().nullable(),
  slug: z.string().nullable(),
  summary: z.string(),
  transcript: z.string().nullable(),
  speakers: z.array(z.string()),
  topics: z.array(z.string()),
  seo: z.object({ description: z.string(), tags: z.array(z.string()) }),
  segments: z.array(SegmentInput),
  songs: z.array(SongInput),
})

export type EditSermonPayload = z.infer<typeof EditSermonSchema>

const SEGMENT_TYPE_SET = new Set<string>(SEGMENT_TYPES)

function intSec(n: number): number {
  return Math.max(0, Math.round(Number.isFinite(n) ? n : 0))
}

/** Trim, drop empties, dedupe (case-insensitive), preserving first-seen order. */
function cleanList(list: string[], lowercase = false): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const v = (lowercase ? raw.toLowerCase() : raw).trim()
    if (!v) continue
    const k = v.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

function emptyToNull(s: string | null): string | null {
  const v = (s ?? "").trim()
  return v || null
}

/**
 * Normalize the editor payload into the persisted shape. `cap` bounds every
 * timestamp (the duration, when known). Sorting + clamping + dropping invalid
 * spans keeps the chapter list playable on the site without overriding the
 * operator's structural choices.
 */
export function normalizeEditPayload(payload: EditSermonPayload) {
  const cap =
    payload.durationSec && payload.durationSec > 0
      ? payload.durationSec
      : Math.max(
          0,
          ...payload.segments.map((s) => intSec(s.endSec)),
          ...payload.songs.map((s) => intSec(s.endSec)),
        ) || Number.MAX_SAFE_INTEGER

  const clamp = (n: number) => Math.min(intSec(n), cap)

  const segments = payload.segments
    .map((s) => {
      const type = (SEGMENT_TYPE_SET.has(s.type) ? s.type : "other") as SegmentType
      const isMessage = type === "sermon" || type === "discussion"
      const pStart = clamp(s.startSec)
      const pEnd = clamp(s.endSec)
      // Preserve in-chapter sub-sections through a manual edit: clamp each inside
      // the (clamped) parent, keep order, drop overlaps/empties. Mirrors the
      // finalize repair so the editor and the model path can't drift.
      const children: { startSec: number; endSec: number; title: string }[] = []
      let cursor = pStart
      for (const c of [...(s.children ?? [])].sort((a, b) => a.startSec - b.startSec)) {
        const title = c.title.trim()
        if (!title) continue
        const cs = Math.max(cursor, Math.min(pEnd, clamp(c.startSec)))
        const ce = Math.min(pEnd, Math.max(cs, clamp(c.endSec)))
        if (ce <= cs) continue
        children.push({ startSec: cs, endSec: ce, title })
        cursor = ce
      }
      return {
        startSec: pStart,
        endSec: pEnd,
        type,
        title: s.title.trim(),
        summary: s.summary.trim(),
        // Speakers live only on message chapters; cleared elsewhere so they can't
        // leak into the derived service speaker line.
        speakers: isMessage ? cleanList(s.speakers) : [],
        scriptureRefs: cleanList(s.scriptureRefs),
        children: children.length >= 2 ? children : [],
      }
    })
    .filter((s) => s.endSec > s.startSec)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec)

  // Service speakers are derived from the message chapters (union, in play order),
  // so the whole-service line matches the per-message attribution. Fall back to the
  // explicit speakers field only when no message chapter names anyone (legacy rows).
  const chapterSpeakers = cleanList(
    segments.filter((s) => s.type === "sermon" || s.type === "discussion").flatMap((s) => s.speakers),
  )
  const speakers = chapterSpeakers.length > 0 ? chapterSpeakers : cleanList(payload.speakers)

  const songs = payload.songs
    .map((s) => ({
      title: s.title.trim(),
      leader: emptyToNull(s.leader),
      kind: (s.kind === "program" ? "program" : "worship") as "worship" | "program",
      topic: emptyToNull(s.topic ? s.topic.toLowerCase() : s.topic),
      startSec: clamp(s.startSec),
      endSec: clamp(s.endSec),
    }))
    .filter((s) => s.endSec > s.startSec)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec)

  return {
    generatedTitle: emptyToNull(payload.generatedTitle),
    format: payload.format === "discussion" ? "discussion" : "sermon",
    publishedAt: emptyToNull(payload.publishedAt),
    thumbnailUrl: emptyToNull(payload.thumbnailUrl),
    durationSec: payload.durationSec && payload.durationSec > 0 ? intSec(payload.durationSec) : null,
    summary: payload.summary.trim(),
    transcript: payload.transcript,
    speakers,
    topics: cleanList(payload.topics, true),
    seo: {
      description: payload.seo.description.trim(),
      tags: cleanList(payload.seo.tags, true),
    },
    segments,
    songs,
  }
}

/** A readable, unique slug for a manually-set value: collisions get the video id suffixed. */
async function uniqueManualSlug(
  admin: Admin,
  candidate: string,
  selfId: string,
  videoId: string,
): Promise<string> {
  const { data } = await admin
    .from("sermons")
    .select("id")
    .eq("slug", candidate)
    .neq("id", selfId)
    .maybeSingle()
  if (!data) return candidate
  return `${candidate}-${videoId.slice(0, 6).toLowerCase()}`
}

export type UpdateSermonResult =
  | { ok: true; id: string; status: string; slug: string | null }
  | { ok: false; error: string }

/**
 * Apply a human edit to a service. Editing an already-published service pulls it
 * back to `review` (per the owner's choice) so it leaves ms.church until a human
 * re-publishes; every other status is left untouched. Slug is only changed when
 * the operator explicitly sets a new one (renaming a live URL is deliberate, not
 * a side effect of editing the title).
 */
export async function updateSermon(
  id: string,
  payload: EditSermonPayload,
  userId: string,
): Promise<UpdateSermonResult> {
  const admin = createSupabaseAdminClient()
  const { data: row, error } = await admin
    .from("sermons")
    .select("id, youtube_video_id, slug, status")
    .eq("id", id)
    .maybeSingle()
  if (error || !row) return { ok: false, error: "not_found" }

  const n = normalizeEditPayload(payload)

  // Slug: keep the existing one unless the operator typed a different value.
  let slug = row.slug
  const requested = slugify(payload.slug ?? "")
  if (requested && requested !== row.slug) {
    slug = await uniqueManualSlug(admin, requested, row.id, row.youtube_video_id)
  }

  // Editing a live service takes it off the site until re-published.
  const status = row.status === "published" ? "review" : row.status

  const { error: upErr } = await admin
    .from("sermons")
    .update({
      generated_title: n.generatedTitle,
      format: n.format,
      published_at: n.publishedAt,
      thumbnail_url: n.thumbnailUrl,
      duration_sec: n.durationSec,
      slug,
      summary: n.summary,
      transcript: n.transcript,
      speakers: n.speakers,
      topics: n.topics,
      seo: n.seo as unknown as Json,
      segments: n.segments as unknown as Sermon["segments"],
      songs: n.songs as unknown as Sermon["songs"],
      status,
      error: null,
    })
    .eq("id", id)
  if (upErr) return { ok: false, error: upErr.message }

  await logAudit({
    action: "sermon.update",
    actorUserId: userId,
    targetTable: "sermons",
    targetId: id,
    diff: {
      chapters: n.segments.length,
      songs: n.songs.length,
      demotedFromPublished: row.status === "published",
    },
  })

  return { ok: true, id, status, slug }
}
