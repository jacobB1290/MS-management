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
  "segmented",
  "review",
  "published",
  "failed",
])

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
    admin.from("sermons").select("id, youtube_video_id, status"),
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

/**
 * Queue selected past videos for processing. Re-arms a previously failed/skipped
 * item back to `pending`; leaves anything already pending/running/done untouched
 * (idempotent — clicking twice doesn't double-process). A video that already has
 * a sermon row mid-pipeline is skipped here; the worker would no-op it anyway.
 */
export async function enqueueBackfill(
  videos: { videoId: string; title?: string | null; publishedAt?: string | null }[],
  userId: string,
): Promise<EnqueueResult> {
  const admin = createSupabaseAdminClient()
  const ids = videos.map((v) => v.videoId).filter(Boolean)
  if (ids.length === 0) return { enqueued: 0, skipped: 0 }

  // Don't re-enqueue videos already represented by a sermon row mid/post-pipeline.
  const { data: sermonRows } = await admin
    .from("sermons")
    .select("youtube_video_id, status")
    .in("youtube_video_id", ids)
  const hasSermon = new Set(
    (sermonRows ?? [])
      .filter((s) => SERMON_ACTIVE.has(s.status))
      .map((s) => s.youtube_video_id),
  )

  // Leave active/terminal-success queue rows alone; re-arm everything else.
  const { data: queueRows } = await admin
    .from("sermon_backfill_queue")
    .select("youtube_video_id, status")
    .in("youtube_video_id", ids)
  const locked = new Set(
    (queueRows ?? [])
      .filter((q) => ["pending", "running", "done"].includes(q.status))
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
    action: "sermon.backfill_enqueue",
    actorUserId: userId,
    targetTable: "sermon_backfill_queue",
    targetId: null,
    diff: { enqueued: toUpsert.length, skipped },
  })
  return { enqueued: toUpsert.length, skipped }
}

export type DrainResult = {
  ok: boolean
  drained: boolean
  videoId?: string
  sermonId?: string | null
  status?: "done" | "skipped" | "failed"
  detail?: string
  /** Pending items still in the queue after this tick. */
  remaining?: number
}

/**
 * Claim and process ONE pending item. Called by the pg_cron worker every 5 min.
 * The claim is an optimistic `status = 'pending'` guard (no row locks): if two
 * ticks overlap, only one UPDATE flips the row to `running`; the loser matches 0
 * rows and reports `drained: false`. Segmenting is minutes-long, so one-per-tick
 * keeps each invocation inside the function timeout while still chewing through
 * the catalog over successive ticks.
 */
export async function drainNextBackfill(): Promise<DrainResult> {
  const admin = createSupabaseAdminClient()

  const { data: next } = await admin
    .from("sermon_backfill_queue")
    .select("youtube_video_id, title, published_at, attempts, requested_by")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!next) return { ok: true, drained: false }

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
  if (!claimed) return { ok: true, drained: false } // lost the race

  const result = await runSermonPipeline({
    trigger: "backfill",
    userId: next.requested_by,
    videoId: next.youtube_video_id,
    videoMeta: {
      title: next.title ?? "Sunday Service",
      publishedAt: next.published_at,
    },
  })

  const status: "done" | "skipped" | "failed" = !result.ok
    ? "failed"
    : result.noop
      ? "skipped"
      : "done"

  await admin
    .from("sermon_backfill_queue")
    .update({
      status,
      error: result.ok ? null : result.detail ?? "failed",
      finished_at: new Date().toISOString(),
    })
    .eq("youtube_video_id", next.youtube_video_id)

  const { count } = await admin
    .from("sermon_backfill_queue")
    .select("youtube_video_id", { count: "exact", head: true })
    .eq("status", "pending")

  return {
    ok: result.ok,
    drained: true,
    videoId: next.youtube_video_id,
    sermonId: result.sermonId,
    status,
    detail: result.detail,
    remaining: count ?? undefined,
  }
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
