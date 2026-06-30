import type { BadgeProps } from "@/components/ui/badge"

/**
 * Client-safe shapes + presentation maps for the Sermons surfaces. Mirrors the
 * server types in @/server/ai/segmentSermon and @/server/sermons/service but
 * carries no `server-only` import, so list cards, the detail view, and the
 * client action components can all share one vocabulary.
 */

/** A sub-section within a chapter — a jump point in the chapter list, never its
 *  own chapter. Usually a message that works through several parts. */
export type SermonSubChapter = {
  startSec: number
  endSec: number
  title: string
}

export type SermonSegment = {
  startSec: number
  endSec: number
  type: string
  title: string
  summary: string
  /** Who delivered this chapter's message — only for "sermon"/"discussion" chapters, else []. */
  speakers: string[]
  scriptureRefs: string[]
  /** Distinct, jump-worthy parts within this one chapter; usually empty. */
  children: SermonSubChapter[]
}

export type SongKind = "worship" | "program"

/** A single song clip — mirrors @/server/ai/segmentContract's SermonSong, client-safe. */
export type SermonSong = {
  title: string
  leader: string | null
  kind: SongKind
  topic: string | null
  startSec: number
  endSec: number
}

export type SermonFormat = "sermon" | "discussion"

export type SermonSeo = { description: string; tags: string[] } | null

export type StepName = "detect" | "transcribe" | "segment"
export type StepStatus = "running" | "succeeded" | "failed" | "skipped" | "pending"

export type PipelineStep = {
  name: StepName
  status: Exclude<StepStatus, "pending">
  startedAt: string
  finishedAt: string | null
  detail?: string
  error?: string
}

export type BadgeVariant = NonNullable<BadgeProps["variant"]>

/** Sermon lifecycle → label + badge color. */
export const SERMON_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  detected: { label: "Detected", variant: "muted" },
  transcribing: { label: "Transcribing", variant: "gold" },
  transcribed: { label: "Transcribed", variant: "default" },
  segmenting: { label: "Segmenting", variant: "gold" },
  segmented: { label: "Segmented", variant: "default" },
  review: { label: "In review", variant: "gold" },
  published: { label: "Published", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
  skipped: { label: "Skipped", variant: "muted" },
}

export function sermonStatus(status: string): { label: string; variant: BadgeVariant } {
  return SERMON_STATUS[status] ?? { label: status, variant: "muted" }
}

/** Run status → label + badge color. */
export const RUN_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  running: { label: "Running", variant: "gold" },
  succeeded: { label: "Succeeded", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
}

export function runStatus(status: string): { label: string; variant: BadgeVariant } {
  return RUN_STATUS[status] ?? { label: status, variant: "muted" }
}

export const STEP_LABEL: Record<StepName, string> = {
  detect: "Detect",
  transcribe: "Transcribe",
  segment: "Segment",
}
export const STEP_ORDER: StepName[] = ["detect", "transcribe", "segment"]

/** A chapter type → friendly label. The full vocabulary the segmenter emits. */
export const SEGMENT_LABEL: Record<string, string> = {
  welcome: "Welcome",
  worship: "Worship",
  scripture: "Scripture",
  prayer: "Prayer",
  sermon: "Sermon",
  discussion: "Discussion",
  poem: "Poem",
  testimony: "Testimony",
  offering: "Offering",
  announcement: "Announcement",
  benediction: "Benediction",
  other: "Other",
}

/** The sermon (the message) is the star — gold; everything else reads quiet. */
export function segmentVariant(type: string): BadgeVariant {
  if (type === "sermon") return "gold"
  if (type === "scripture") return "default"
  return "muted"
}

/**
 * Parse a "mm:ss" / "h:mm:ss" / bare-seconds string back into seconds — the
 * inverse of formatClock, for the service editor's timestamp fields. Tolerant of
 * partial input while typing; a blank or unparseable value is 0.
 */
export function parseClock(input: string): number {
  const raw = input.trim()
  if (!raw) return 0
  const parts = raw.split(":").map((p) => p.trim())
  if (parts.some((p) => p !== "" && !/^\d+$/.test(p))) return 0
  const nums = parts.map((p) => (p === "" ? 0 : Number(p)))
  let sec = 0
  for (const n of nums) sec = sec * 60 + n
  return Math.max(0, Math.round(sec))
}

/** "mm:ss" or "h:mm:ss" — chapter timestamps + YouTube deep-link labels. */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const ss = String(sec).padStart(2, "0")
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`
  return `${m}:${ss}`
}

/** "42 min" / "1 hr 12 min" — a relaxed duration for headers. */
export function formatLength(totalSec: number | null): string | null {
  if (!totalSec || totalSec <= 0) return null
  const mins = Math.round(totalSec / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

/** Wall-clock span of a run, "3.2s" / "1m 04s", from its step or run stamps. */
export function formatElapsed(startIso: string, endIso: string | null): string | null {
  if (!endIso) return null
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, "0")}s`
}

/** A YouTube deep link to a chapter start. */
export function youtubeChapterUrl(videoId: string, startSec: number): string {
  return `https://youtu.be/${videoId}?t=${Math.max(0, Math.floor(startSec))}`
}

/* ----------------------------------------------------------------------- */
/* Back-catalog backfill (the "Process past services" picker)              */
/* ----------------------------------------------------------------------- */

export type BackfillState =
  | "new"
  | "queued"
  | "processing"
  | "review"
  | "published"
  | "in_progress"
  | "failed"
  | "skipped"

export type BackfillCandidate = {
  videoId: string
  title: string
  /** The AI-generated public title once the service has been segmented; null otherwise. */
  generatedTitle: string | null
  publishedAt: string | null
  thumbnailUrl: string
  state: BackfillState
  sermonId: string | null
  sermonStatus: string | null
  queueStatus: string | null
  queueError: string | null
  selectable: boolean
}

/**
 * Outcome of the live YouTube playlist read that feeds the backfill picker.
 *  - `ok`           — the playlist was read; the candidate list is complete.
 *  - `unconfigured` — no YouTube creds (mock mode); nothing to read.
 *  - `quota`        — Google's daily API limit was hit (403/429 quota reason).
 *  - `error`        — the playlist was otherwise unreachable this request.
 * When not `ok`, the picker still renders every service the CRM already tracks
 * (from its own DB); only discovery of brand-new videos to process is paused.
 */
export type PlaylistReadStatus = "ok" | "unconfigured" | "quota" | "error"

export type BackfillListing = {
  configured: boolean
  /** Status of the live playlist read — drives the degraded banner in the picker. */
  playlistStatus: PlaylistReadStatus
  candidates: BackfillCandidate[]
  counts: {
    total: number
    new: number
    queuedOrRunning: number
    review: number
    published: number
    failed: number
  }
}

/** Backfill state → label + badge color for the picker rows. */
export const BACKFILL_STATE: Record<BackfillState, { label: string; variant: BadgeVariant }> = {
  new: { label: "Not processed", variant: "muted" },
  queued: { label: "Queued", variant: "default" },
  processing: { label: "Processing", variant: "gold" },
  in_progress: { label: "In progress", variant: "gold" },
  review: { label: "Ready to review", variant: "gold" },
  published: { label: "Published", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
  skipped: { label: "Skipped", variant: "muted" },
}
