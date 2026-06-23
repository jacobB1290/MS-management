import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import type { Tables } from "@/lib/database.types"
import { fetchLatestVideo, fetchRecentVideos, type FeedVideo } from "@/server/youtube/feed"
import { fetchTranscript, hasCaptionAccess } from "@/server/youtube/captions"
import { isAiEnabled } from "@/server/ai/client"
import { segmentSermon, type SermonSegment } from "@/server/ai/segmentSermon"

/**
 * Sermon pipeline orchestration. One run = detect → transcribe → segment, with
 * every step recorded on a `sermon_pipeline_runs` row so the CRM "Sermons" tab
 * shows exactly what happened, what's running, and what failed. The `sermons`
 * row is the working copy; it lands at status `review` so a human publishes it
 * (publishing is what makes it appear on ms.church via the public feed) — we do
 * not auto-publish AI output to the live site.
 *
 * Everything degrades cleanly when creds are missing (mirrors events/Twilio):
 *   - no caption OAuth  -> transcribe step fails with reason "no_access", the run
 *                          is marked failed, and the sermon stays at "detected"
 *   - no ANTHROPIC key  -> segment step fails "disabled", sermon stays "transcribed"
 * so the affordance + monitor are fully usable before the YouTube scope is added.
 */

type Sermon = Tables<"sermons">
export type PipelineTrigger = "cron" | "manual" | "backfill"

export type StepStatus = "running" | "succeeded" | "failed" | "skipped"
export type PipelineStep = {
  name: "detect" | "transcribe" | "segment"
  status: StepStatus
  startedAt: string
  finishedAt: string | null
  detail?: string
  error?: string
}

export type RunResult = {
  ok: boolean
  runId: string
  sermonId: string | null
  videoId: string | null
  status: "succeeded" | "failed"
  steps: PipelineStep[]
  /** Set when nothing needed doing (already processed, or no video found). */
  noop?: boolean
  detail?: string
}

type Admin = ReturnType<typeof createSupabaseAdminClient>

// Statuses past which the cron should not re-process a video automatically.
const PROCESSED = new Set(["segmented", "review", "published"])

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function dateStamp(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

/** A readable, unique slug. Collisions get the video id suffixed. */
async function uniqueSlug(
  admin: Admin,
  title: string,
  publishedAt: string | null,
  videoId: string,
  selfId: string,
): Promise<string> {
  const base = `${slugify(title) || "service"}-${dateStamp(publishedAt)}`
  const { data } = await admin
    .from("sermons")
    .select("id, slug")
    .eq("slug", base)
    .maybeSingle()
  if (!data || data.id === selfId) return base
  return `${base}-${videoId.slice(0, 6).toLowerCase()}`
}

/**
 * The distinct topics already used across sermons, handed to the segmenter so it
 * reuses an existing topic when one fits instead of coining near-duplicates (the
 * same reuse-first idea as contact tags). These become the public site's topic
 * filter chips + SEO topic pages, so a tight, consistent vocabulary matters.
 * Sorted + capped for a byte-stable prompt prefix.
 */
async function fetchKnownTopics(admin: Admin): Promise<string[]> {
  const { data } = await admin.from("sermons").select("topics")
  const set = new Set<string>()
  for (const row of data ?? []) {
    for (const t of ((row.topics as string[] | null) ?? [])) {
      const v = String(t).trim().toLowerCase()
      if (v) set.add(v)
    }
  }
  return Array.from(set).sort().slice(0, 200)
}

/** Live tracker that persists the run's step list after every transition. */
class RunRecorder {
  private steps: PipelineStep[] = []
  constructor(
    private admin: Admin,
    private runId: string,
  ) {}

  current(): PipelineStep[] {
    return this.steps
  }

  async start(name: PipelineStep["name"]): Promise<void> {
    this.steps.push({ name, status: "running", startedAt: new Date().toISOString(), finishedAt: null })
    await this.flush()
  }

  async finish(
    name: PipelineStep["name"],
    status: Exclude<StepStatus, "running">,
    extra?: { detail?: string; error?: string },
  ): Promise<void> {
    const step = [...this.steps].reverse().find((s) => s.name === name && s.status === "running")
    if (step) {
      step.status = status
      step.finishedAt = new Date().toISOString()
      if (extra?.detail) step.detail = extra.detail
      if (extra?.error) step.error = extra.error
    }
    await this.flush()
  }

  private async flush(): Promise<void> {
    await this.admin
      .from("sermon_pipeline_runs")
      .update({ steps: this.steps as unknown as Tables<"sermons">["segments"] })
      .eq("id", this.runId)
  }
}

/** Find an existing sermon row for a video, or create a fresh `detected` one. */
async function upsertSermonRow(
  admin: Admin,
  video: { videoId: string; title: string; publishedAt: string | null; thumbnailUrl: string },
  userId: string | null,
): Promise<{ sermon: Sermon; created: boolean } | { error: string }> {
  const { data: existing } = await admin
    .from("sermons")
    .select("*")
    .eq("youtube_video_id", video.videoId)
    .maybeSingle()
  if (existing) return { sermon: existing, created: false }

  const { data, error } = await admin
    .from("sermons")
    .insert({
      youtube_video_id: video.videoId,
      title: video.title,
      published_at: video.publishedAt,
      thumbnail_url: video.thumbnailUrl,
      status: "detected",
      source: "youtube",
      created_by: userId,
    })
    .select("*")
    .single()
  if (error || !data) return { error: error?.message ?? "sermon_insert_failed" }
  return { sermon: data, created: true }
}

/** Resolve the target video for this run from feed metadata when possible. */
async function resolveVideo(
  videoId: string | undefined,
  videoMeta?: RunOptions["videoMeta"],
): Promise<FeedVideo | null> {
  if (!videoId) return fetchLatestVideo()
  const recent = await fetchRecentVideos(15)
  const found = recent.find((v) => v.videoId === videoId)
  if (found) return found
  // Caller-supplied metadata (backfill carries the real playlist title + date so
  // the slug and the public card aren't a generic "Sunday Service").
  if (videoMeta) {
    return {
      videoId,
      title: videoMeta.title || "Sunday Service",
      publishedAt: videoMeta.publishedAt ?? null,
      thumbnailUrl:
        videoMeta.thumbnailUrl ||
        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    }
  }
  // Not in the recent feed and no metadata: minimal, captions still work.
  return {
    videoId,
    title: "Sunday Service",
    publishedAt: null,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
  }
}

export type RunOptions = {
  trigger: PipelineTrigger
  userId?: string | null
  /** Target a specific video; omit for the cron's "latest" behavior. */
  videoId?: string
  /**
   * Real video metadata for a target outside the recent RSS feed (backfill of an
   * old service). Without it, an old `videoId` falls back to a generic title.
   */
  videoMeta?: { title: string; publishedAt: string | null; thumbnailUrl?: string }
  /** Re-run all steps even if the sermon is already processed. */
  force?: boolean
}

/**
 * Run the pipeline for one video. Always returns a result (never throws); a
 * failed run is recorded, not raised, so the cron stays green and the monitor
 * shows the failure.
 */
export async function runSermonPipeline(opts: RunOptions): Promise<RunResult> {
  const admin = createSupabaseAdminClient()
  const userId = opts.userId ?? null

  const video = await resolveVideo(opts.videoId, opts.videoMeta)

  // Open the run row up front so even a no-video run is visible in the monitor.
  const { data: run, error: runErr } = await admin
    .from("sermon_pipeline_runs")
    .insert({
      youtube_video_id: video?.videoId ?? "unknown",
      status: "running",
      trigger: opts.trigger,
      created_by: userId,
    })
    .select("id")
    .single()
  if (runErr || !run) {
    return {
      ok: false,
      runId: "",
      sermonId: null,
      videoId: video?.videoId ?? null,
      status: "failed",
      steps: [],
      detail: runErr?.message ?? "run_insert_failed",
    }
  }

  const rec = new RunRecorder(admin, run.id)

  const fail = async (
    sermonId: string | null,
    detail: string,
  ): Promise<RunResult> => {
    await admin
      .from("sermon_pipeline_runs")
      .update({ status: "failed", error: detail, finished_at: new Date().toISOString(), sermon_id: sermonId })
      .eq("id", run.id)
    if (sermonId) {
      await admin.from("sermons").update({ status: "failed", error: detail }).eq("id", sermonId)
    }
    await logAudit({
      action: "sermon.run",
      actorUserId: userId,
      targetTable: "sermon_pipeline_runs",
      targetId: run.id,
      diff: { trigger: opts.trigger, status: "failed", videoId: video?.videoId ?? null },
    })
    return {
      ok: false,
      runId: run.id,
      sermonId,
      videoId: video?.videoId ?? null,
      status: "failed",
      steps: rec.current(),
      detail,
    }
  }

  // ---- Step 1: detect ----
  await rec.start("detect")
  if (!video) {
    await rec.finish("detect", "failed", { error: "no_video_in_feed" })
    return fail(null, "no_video_in_feed")
  }
  const up = await upsertSermonRow(admin, video, userId)
  if ("error" in up) {
    await rec.finish("detect", "failed", { error: up.error })
    return fail(null, up.error)
  }
  let sermon = up.sermon
  await admin.from("sermon_pipeline_runs").update({ sermon_id: sermon.id }).eq("id", run.id)

  // Already processed and not forced -> clean no-op (the common cron case).
  if (!opts.force && !up.created && PROCESSED.has(sermon.status)) {
    await rec.finish("detect", "skipped", { detail: `already ${sermon.status}` })
    await admin
      .from("sermon_pipeline_runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString() })
      .eq("id", run.id)
    return {
      ok: true,
      runId: run.id,
      sermonId: sermon.id,
      videoId: video.videoId,
      status: "succeeded",
      steps: rec.current(),
      noop: true,
      detail: `already ${sermon.status}`,
    }
  }
  await rec.finish("detect", "succeeded", {
    detail: up.created ? "new video" : `re-running ${sermon.status}`,
  })

  // ---- Step 2: transcribe ----
  // The segmenter places chapter bounds from caption-level timestamps, so it MUST
  // be fed a timestamped transcript ([mm:ss] lines). We persist only the plain
  // text (for display + the public feed), not the timestamped view, so it cannot
  // be reconstructed from a stored transcript. We therefore ALWAYS (re)download
  // the caption track here to get real timestamps before segmenting. The previous
  // "reuse stored transcript" shortcut fed PLAIN TEXT to the segmenter on
  // non-force re-runs, which made the model ESTIMATE the times and the chapters
  // drift badly. Re-download is one cheap owner-scope API call; correctness wins.
  await rec.start("transcribe")
  if (!hasCaptionAccess()) {
    await rec.finish("transcribe", "failed", { error: "no_access: YouTube caption OAuth not configured" })
    return fail(sermon.id, "youtube_caption_access_unconfigured")
  }
  await admin.from("sermons").update({ status: "transcribing", error: null }).eq("id", sermon.id)
  const res = await fetchTranscript(video.videoId)
  if (!res.ok) {
    await rec.finish("transcribe", "failed", { error: `${res.reason}${res.detail ? `: ${res.detail}` : ""}` })
    return fail(sermon.id, `transcribe_${res.reason}`)
  }
  const transcriptText = res.transcript.plainText
  const timestamped = res.transcript.timestamped
  const durationSec = res.transcript.durationSec
  const { error: tErr } = await admin
    .from("sermons")
    .update({
      transcript: transcriptText,
      duration_sec: durationSec,
      status: "transcribed",
      error: null,
    })
    .eq("id", sermon.id)
  if (tErr) {
    await rec.finish("transcribe", "failed", { error: tErr.message })
    return fail(sermon.id, tErr.message)
  }
  await rec.finish("transcribe", "succeeded", {
    detail: `${res.transcript.cues.length} cues, ~${Math.round(durationSec / 60)} min${res.transcript.isAutoGenerated ? ", auto-captions" : ""}`,
  })

  if (!transcriptText || !timestamped) {
    return fail(sermon.id, "empty_transcript")
  }

  // ---- Step 3: segment ----
  await rec.start("segment")
  if (!isAiEnabled() || !process.env.ANTHROPIC_API_KEY) {
    await rec.finish("segment", "failed", { error: "disabled: ANTHROPIC_API_KEY not set" })
    // Transcript is saved; leave the sermon at 'transcribed' (not 'failed') so a
    // later run with the key set finishes the job.
    await admin
      .from("sermon_pipeline_runs")
      .update({ status: "failed", error: "segment_disabled", finished_at: new Date().toISOString() })
      .eq("id", run.id)
    await logAudit({
      action: "sermon.run",
      actorUserId: userId,
      targetTable: "sermon_pipeline_runs",
      targetId: run.id,
      diff: { trigger: opts.trigger, status: "failed", step: "segment", reason: "disabled" },
    })
    return {
      ok: false,
      runId: run.id,
      sermonId: sermon.id,
      videoId: video.videoId,
      status: "failed",
      steps: rec.current(),
      detail: "segment_disabled",
    }
  }
  await admin.from("sermons").update({ status: "segmenting", error: null }).eq("id", sermon.id)
  const knownTopics = await fetchKnownTopics(admin)
  const seg = await segmentSermon(timestamped, durationSec, knownTopics)
  if (!seg.ok) {
    await rec.finish("segment", "failed", { error: `${seg.reason}${seg.detail ? `: ${seg.detail}` : ""}` })
    return fail(sermon.id, `segment_${seg.reason}`)
  }

  const slug = await uniqueSlug(admin, sermon.title, sermon.published_at, video.videoId, sermon.id)
  // Core result — works on any schema version, so the autonomous cron run still
  // lands a reviewable sermon even if migration 0038 (the watch-library columns)
  // hasn't been applied yet.
  const { error: sErr } = await admin
    .from("sermons")
    .update({
      segments: seg.data.segments as unknown as Sermon["segments"],
      summary: seg.data.summary,
      seo: seg.data.seo as unknown as Sermon["seo"],
      slug,
      status: "review",
      error: null,
    })
    .eq("id", sermon.id)
  if (sErr) {
    await rec.finish("segment", "failed", { error: sErr.message })
    return fail(sermon.id, sErr.message)
  }
  // Classification fields from migration 0038 (format / speakers / topics).
  // Best-effort + logged: a not-yet-migrated database still completes the sermon
  // (the public feed defaults format to 'sermon' and topics to []); a re-run
  // after the migration backfills these.
  const { error: cErr } = await admin
    .from("sermons")
    .update({
      generated_title: seg.data.title,
      format: seg.data.format,
      speakers: seg.data.speakers,
      topics: seg.data.topics,
      songs: seg.data.songs as unknown as Sermon["segments"],
    })
    .eq("id", sermon.id)
  if (cErr) {
    console.error("sermon classification write failed (are migrations 0038/0040 applied?):", cErr.message)
  }
  await rec.finish("segment", "succeeded", {
    detail: `${seg.data.segments.length} chapters`,
  })

  await admin
    .from("sermon_pipeline_runs")
    .update({ status: "succeeded", finished_at: new Date().toISOString() })
    .eq("id", run.id)
  await logAudit({
    action: "sermon.segment",
    actorUserId: userId,
    targetTable: "sermons",
    targetId: sermon.id,
    diff: { trigger: opts.trigger, chapters: seg.data.segments.length, videoId: video.videoId },
  })

  return {
    ok: true,
    runId: run.id,
    sermonId: sermon.id,
    videoId: video.videoId,
    status: "succeeded",
    steps: rec.current(),
  }
}

export type PublishResult = { ok: true; id: string } | { ok: false; error: string }

/** Publish a reviewed sermon: it becomes visible on ms.church via the feed. */
export async function publishSermon(id: string, userId: string): Promise<PublishResult> {
  const admin = createSupabaseAdminClient()
  const { data: row, error } = await admin.from("sermons").select("*").eq("id", id).maybeSingle()
  if (error || !row) return { ok: false, error: "not_found" }
  if (!row.transcript || (row.segments as SermonSegment[] | null)?.length === 0) {
    return { ok: false, error: "not_ready" }
  }
  const { error: upErr } = await admin
    .from("sermons")
    .update({ status: "published", published_at: row.published_at ?? new Date().toISOString(), error: null })
    .eq("id", id)
  if (upErr) return { ok: false, error: upErr.message }

  await logAudit({
    action: "sermon.publish",
    actorUserId: userId,
    targetTable: "sermons",
    targetId: id,
  })
  return { ok: true, id }
}

/** Take a sermon off the public site (back to review). */
export async function unpublishSermon(id: string, userId: string): Promise<PublishResult> {
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from("sermons").update({ status: "review" }).eq("id", id)
  if (error) return { ok: false, error: error.message }
  await logAudit({
    action: "sermon.unpublish",
    actorUserId: userId,
    targetTable: "sermons",
    targetId: id,
  })
  return { ok: true, id }
}

/**
 * Permanently delete a sermon (admin). The YouTube video itself is untouched —
 * this only removes the CRM's working copy + published record, so a future run
 * would re-detect the video as new.
 */
export async function deleteSermon(id: string, userId: string): Promise<PublishResult> {
  const admin = createSupabaseAdminClient()
  const { data: row } = await admin.from("sermons").select("title").eq("id", id).maybeSingle()
  const { error } = await admin.from("sermons").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }
  await logAudit({
    action: "sermon.delete",
    actorUserId: userId,
    targetTable: "sermons",
    targetId: id,
    diff: row ? { title: row.title } : undefined,
  })
  return { ok: true, id }
}
