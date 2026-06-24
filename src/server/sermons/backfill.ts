import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import { fetchAllPlaylistVideos } from "@/server/youtube/feed"
import type {
  BackfillState,
  BackfillCandidate,
  BackfillListing,
} from "@/app/(app)/sermons/types"
import { runSermonPipeline, publishSermon } from "./service"

/**
 * Back-catalog backfill: turn years of past service livestreams into reviewable
 * /watch library items. Staff pick past videos in the CRM; each is enqueued on
 * `sermon_backfill_queue` and a Supabase pg_cron worker (0039) drains the queue
 * SERVER-SIDE, one item per tick, so the whole catalog processes with NO CRM
 * instance open. Every item runs the same transcribe → segment pipeline and
 * lands at status `review`; a human bulk-publishes from there — we never
 * auto-publish AI output to the live site.
 *
 * Only the picker (listBackfillCandidates) and the actions (enqueue, bulk
 * publish) are interactive; the actual processing is autonomous.
 */

/** Sermon statuses that mean a video has already been (or is being) processed. */
const SERMON_ACTIVE = new Set([
  "detected",
  "transcribing",
  "transcribed",
  "segmenting",
  "awaiting_segmentation",
  "segmented",
  "review",
  "published",
  "failed",
])

/**
 * Statuses where a run is mid-flight, so a RE-RUN (force) request is skipped: the
 * existing run owns the row. Everything else (segmented/review/published/failed)
 * is fair game to re-process on demand.
 */
const SERMON_BUSY = new Set(["transcribing", "segmenting", "awaiting_segmentation"])

function sermonState(status: string): BackfillState {
  if (status === "published") return "published"
  if (status === "review" || status === "segmented") return "review"
  if (status === "failed") return "failed"
  return "in_progress"
}

/**
 * The full playlist crossed with what the CRM already knows: each past video is
 * tagged `new` / `queued` / `processing` / `review` / `published` / `failed` so
 * the picker can show progress and only offer the un-processed ones for select.
 */
export async function listBackfillCandidates(): Promise<BackfillListing> {
  const admin = createSupabaseAdminClient()
  const videos = await fetchAllPlaylistVideos()

  const [{ data: sermonRows }, { data: queueRows }] = await Promise.all([
    admin.from("sermons").select("id, youtube_video_id, status, generated_title"),
    admin
      .from("sermon_backfill_queue")
      .select("youtube_video_id, status, error"),
  ])

  const sermonByVideo = new Map(
    (sermonRows ?? []).map((s) => [s.youtube_video_id, s]),
  )
  const queueByVideo = new Map(
    (queueRows ?? []).map((q) => [q.youtube_video_id, q]),
  )

  const candidates: BackfillCandidate[] = videos.map((v) => {
    const sermon = sermonByVideo.get(v.videoId) ?? null
    const queue = queueByVideo.get(v.videoId) ?? null

    let state: BackfillState
    if (sermon) {
      state = sermonState(sermon.status)
    } else if (queue?.status === "running") {
      state = "processing"
    } else if (queue?.status === "pending") {
      state = "queued"
    } else if (queue?.status === "failed") {
      state = "failed"
    } else if (queue?.status === "skipped") {
      state = "skipped"
    } else {
      state = "new"
    }

    // Selectable = nothing useful exists yet, or the last attempt failed/skipped.
    const selectable =
      state === "new" || state === "failed" || state === "skipped"

    return {
      videoId: v.videoId,
      title: v.title,
      generatedTitle: sermon?.generated_title ?? null,
      publishedAt: v.publishedAt,
      thumbnailUrl: v.thumbnailUrl,
      state,
      sermonId: sermon?.id ?? null,
      sermonStatus: sermon?.status ?? null,
      queueStatus: queue?.status ?? null,
      queueError: queue?.error ?? null,
      selectable,
    }
  })

  const counts = {
    total: candidates.length,
    new: candidates.filter((c) => c.state === "new").length,
    queuedOrRunning: candidates.filter(
      (c) => c.state === "queued" || c.state === "processing",
    ).length,
    review: candidates.filter((c) => c.state === "review").length,
    published: candidates.filter((c) => c.state === "published").length,
    failed: candidates.filter((c) => c.state === "failed").length,
  }

  return { configured: videos.length > 0, candidates, counts }
}

export type EnqueueResult = { enqueued: number; skipped: number }
export type EnqueueOptions = {
  /**
   * Re-run videos that are ALREADY processed (the "Re-run" action on published /
   * reviewed services). The worker passes this through as the pipeline's `force`,
   * so the sermon is re-segmented and lands back at `review`. Without it, enqueue
   * keeps its first-pass behavior: already-processed videos are skipped.
   */
  force?: boolean
  /**
   * "Hold for Claude Code": process detect + transcribe, then HAND the
   * segmentation to a Claude Code session (park a segmentation_job) instead of
   * calling the metered Anthropic API. The /segment-finalize cron completes it.
   * Persisted per-item on the queue row so the server-side drain honors the
   * choice with no CRM instance open. Default false = the standard API path.
   */
  holdForClaude?: boolean
}

/**
 * Queue selected past videos for processing. Re-arms a previously failed/skipped
 * item back to `pending`; leaves anything already pending/running/done untouched
 * (idempotent — clicking twice doesn't double-process). A video that already has
 * a sermon row mid-pipeline is skipped here; the worker would no-op it anyway.
 *
 * With `force`, it instead RE-RUNS already-processed services: it re-arms even a
 * `done` queue row and a published/reviewed sermon, skipping only the ones whose
 * run is genuinely mid-flight (transcribing/segmenting) or already pending.
 */
export async function enqueueBackfill(
  videos: { videoId: string; title?: string | null; publishedAt?: string | null }[],
  userId: string,
  opts: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const admin = createSupabaseAdminClient()
  const force = opts.force === true
  const ids = videos.map((v) => v.videoId).filter(Boolean)
  if (ids.length === 0) return { enqueued: 0, skipped: 0 }

  // First pass: skip anything already represented by a sermon row mid/post-pipeline.
  // Re-run: only skip the ones whose run is actively in flight — re-processing a
  // segmented/reviewed/published/failed sermon is exactly the point.
  const { data: sermonRows } = await admin
    .from("sermons")
    .select("youtube_video_id, status")
    .in("youtube_video_id", ids)
  const skipSermonStatus = force ? SERMON_BUSY : SERMON_ACTIVE
  const hasSermon = new Set(
    (sermonRows ?? [])
      .filter((s) => skipSermonStatus.has(s.status))
      .map((s) => s.youtube_video_id),
  )

  // First pass: leave active/terminal-success queue rows alone. Re-run: re-arm a
  // finished (`done`) row too, only an active job (pending/running) blocks it.
  const lockedStatuses = force ? ["pending", "running"] : ["pending", "running", "done"]
  const { data: queueRows } = await admin
    .from("sermon_backfill_queue")
    .select("youtube_video_id, status")
    .in("youtube_video_id", ids)
  const locked = new Set(
    (queueRows ?? [])
      .filter((q) => lockedStatuses.includes(q.status))
      .map((q) => q.youtube_video_id),
  )

  const toUpsert = videos.filter(
    (v) => v.videoId && !hasSermon.has(v.videoId) && !locked.has(v.videoId),
  )
  const skipped = ids.length - toUpsert.length
  if (toUpsert.length === 0) return { enqueued: 0, skipped }

  const now = new Date().toISOString()
  const { error } = await admin.from("sermon_backfill_queue").upsert(
    toUpsert.map((v) => ({
      youtube_video_id: v.videoId,
      title: v.title ?? null,
      published_at: v.publishedAt ?? null,
      status: "pending" as const,
      reprocess: force,
      hold_for_claude: opts.holdForClaude === true,
      error: null,
      attempts: 0,
      requested_by: userId,
      requested_at: now,
      started_at: null,
      finished_at: null,
    })),
    { onConflict: "youtube_video_id" },
  )
  if (error) throw new Error(`backfill_enqueue_failed: ${error.message}`)

  await logAudit({
    action: force ? "sermon.backfill_reprocess" : "sermon.backfill_enqueue",
    actorUserId: userId,
    targetTable: "sermon_backfill_queue",
    targetId: null,
    diff: { enqueued: toUpsert.length, skipped, force, holdForClaude: opts.holdForClaude === true },
  })
  return { enqueued: toUpsert.length, skipped }
}

type Admin = ReturnType<typeof createSupabaseAdminClient>

export type DrainItem = {
  videoId: string
  mode: "session" | "api"
  status: "done" | "skipped" | "failed"
  sermonId?: string | null
}

export type DrainResult = {
  ok: boolean
  /** Total queue items processed this tick. */
  drained: number
  /** Session-mode ("Hold for Claude Code") items prepared this tick. */
  held: number
  /** API-mode items processed this tick (0 or 1 — kept serial). */
  api: number
  items: DrainItem[]
  /** Pending items still in the queue after this tick. */
  remaining?: number
}

// Held items are cheap (detect + transcribe + park a job, NO segmentation — that
// goes to a session), so the worker prepares ALL pending held items in a single
// tick. API items run their multi-minute segmentation inline, so they stay
// strictly one-at-a-time (see the guard) and never overlap, which keeps this safe
// at a tight cron cadence.
const HELD_BATCH_CAP = 16
const SOFT_DEADLINE_MS = 240_000 // stay under the route's 300s maxDuration
// Only START an API item early in the invocation, so its long segmentation gets
// the bulk of the function budget. A held-heavy tick defers the API item to the
// next tick (when step 1 is empty and it gets the full window).
const API_START_BUDGET_MS = 30_000

type ClaimedRow = {
  youtube_video_id: string
  title: string | null
  published_at: string | null
  attempts: number | null
  requested_by: string | null
  reprocess: boolean | null
  hold_for_claude: boolean | null
}

/** Atomically claim the oldest pending row of the given mode (held vs API). */
async function claimOldestPending(admin: Admin, held: boolean): Promise<ClaimedRow | null> {
  const { data: next } = await admin
    .from("sermon_backfill_queue")
    .select("youtube_video_id, title, published_at, attempts, requested_by, reprocess, hold_for_claude")
    .eq("status", "pending")
    .eq("hold_for_claude", held)
    .order("requested_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!next) return null
  const { data: claimed } = await admin
    .from("sermon_backfill_queue")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      attempts: (next.attempts ?? 0) + 1,
      error: null,
    })
    .eq("youtube_video_id", next.youtube_video_id)
    .eq("status", "pending") // only one worker wins the row
    .select("youtube_video_id")
    .maybeSingle()
  if (!claimed) return null // lost the race
  return next
}

/** Run the pipeline for a claimed row and stamp its final queue status. */
async function runClaimed(admin: Admin, next: ClaimedRow): Promise<DrainItem> {
  const held = next.hold_for_claude === true
  const result = await runSermonPipeline({
    trigger: "backfill",
    userId: next.requested_by,
    videoId: next.youtube_video_id,
    videoMeta: { title: next.title ?? "Sunday Service", publishedAt: next.published_at },
    // A re-run request re-segments an already-processed service (back to review).
    force: next.reprocess === true,
    // Per-item "Hold for Claude Code": hand segmentation to a session instead of
    // the API. The server-side drain honors the choice with no CRM open.
    segmentMode: held ? "session" : "api",
  })
  const status: "done" | "skipped" | "failed" = !result.ok ? "failed" : result.noop ? "skipped" : "done"
  await admin
    .from("sermon_backfill_queue")
    .update({
      status,
      error: result.ok ? null : result.detail ?? "failed",
      finished_at: new Date().toISOString(),
    })
    .eq("youtube_video_id", next.youtube_video_id)
  return { videoId: next.youtube_video_id, mode: held ? "session" : "api", status, sermonId: result.sermonId }
}

/**
 * Drain the back-catalog queue for one tick. Called by the pg_cron worker.
 *  - Step 1: prepare ALL pending held ("Hold for Claude Code") items — each only
 *    transcribes + parks a segmentation job, so a whole selection lands in the
 *    segmentation queue in ONE tick (bounded by HELD_BATCH_CAP + a time budget)
 *    instead of one-every-tick.
 *  - Step 2: at most ONE API item, only if none is already `running` elsewhere
 *    and we're early enough in the invocation to give its long segmentation room.
 *    So two heavy segmentations can never overlap, even at a tight cadence.
 * Optimistic `status='pending'` claim throughout: overlapping ticks never
 * double-process a row. Never throws — a failed item is marked on its row.
 */
export async function drainNextBackfill(): Promise<DrainResult> {
  const admin = createSupabaseAdminClient()
  const started = Date.now()
  const items: DrainItem[] = []
  let held = 0
  let api = 0

  // 1) Batch every pending held item (cheap: transcribe + park a job).
  while (held < HELD_BATCH_CAP && Date.now() - started < SOFT_DEADLINE_MS) {
    const next = await claimOldestPending(admin, true)
    if (!next) break
    items.push(await runClaimed(admin, next))
    held++
  }

  // 2) At most one API item, kept strictly serial: skip if one is already running
  //    elsewhere, or if the held batch already ate into the function budget.
  if (Date.now() - started < API_START_BUDGET_MS) {
    const { data: runningApi } = await admin
      .from("sermon_backfill_queue")
      .select("youtube_video_id")
      .eq("status", "running")
      .eq("hold_for_claude", false)
      .limit(1)
      .maybeSingle()
    if (!runningApi) {
      const next = await claimOldestPending(admin, false)
      if (next) {
        items.push(await runClaimed(admin, next))
        api++
      }
    }
  }

  const { count } = await admin
    .from("sermon_backfill_queue")
    .select("youtube_video_id", { count: "exact", head: true })
    .eq("status", "pending")

  return { ok: true, drained: items.length, held, api, items, remaining: count ?? undefined }
}

export type BulkPublishResult = {
  published: string[]
  failed: { id: string; error: string }[]
}

/** Publish many reviewed sermons at once (the backfill "bulk publish" action). */
export async function bulkPublishSermons(
  ids: string[],
  userId: string,
): Promise<BulkPublishResult> {
  const out: BulkPublishResult = { published: [], failed: [] }
  for (const id of ids) {
    const r = await publishSermon(id, userId)
    if (r.ok) out.published.push(id)
    else out.failed.push({ id, error: r.error })
  }
  await logAudit({
    action: "sermon.bulk_publish",
    actorUserId: userId,
    targetTable: "sermons",
    targetId: null,
    diff: { published: out.published.length, failed: out.failed.length },
  })
  return out
}
