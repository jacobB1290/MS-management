import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import type { Tables } from "@/lib/database.types"
import { fetchLatestVideo, fetchRecentVideos, type FeedVideo } from "@/server/youtube/feed"
import { fetchTranscript, hasCaptionAccess } from "@/server/youtube/captions"
import { isAiEnabled } from "@/server/ai/client"
import { segmentSermon, type SermonSegment } from "@/server/ai/segmentSermon"
import { applySegmentation } from "./segmentApply"
import { enqueueSegmentationJob } from "./segmentQueue"

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

// slugify / uniqueSlug / applySegmentation moved to ./segmentApply so the API
// path here and the out-of-band finalize path (segmentQueue) share one writer.

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
  /**
   * How step 3 (segment) runs:
   *   'api'     (default) — call the metered Anthropic API now (standard path).
   *   'session' — "Hold for Claude Code": prepare + park a segmentation_job for a
   *               Claude Code session, then the /segment-finalize cron completes it.
   */
  segmentMode?: "api" | "session"
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

  // A force re-run mutates the live sermon row in place (transcribing -> ... ->
  // review). If a re-run of an ALREADY-LIVE sermon fails (e.g. a transient
  // provider error or a billing/usage limit), we must NOT leave it stranded at
  // 'failed' — that silently pulls a good, published service off ms.church. So
  // capture the pre-run status and, on failure, restore a live state instead of
  // failing it. Set after detect resolves the row.
  let priorSermonStatus: string | null = null
  const RESTORABLE_ON_FAIL = new Set(["published", "review"])

  const fail = async (
    sermonId: string | null,
    detail: string,
  ): Promise<RunResult> => {
    await admin
      .from("sermon_pipeline_runs")
      .update({ status: "failed", error: detail, finished_at: new Date().toISOString(), sermon_id: sermonId })
      .eq("id", run.id)
    if (sermonId) {
      // Preserve a live sermon: a failed re-run leaves the existing content up.
      if (priorSermonStatus && RESTORABLE_ON_FAIL.has(priorSermonStatus)) {
        await admin.from("sermons").update({ status: priorSermonStatus, error: null }).eq("id", sermonId)
      } else {
        await admin.from("sermons").update({ status: "failed", error: detail }).eq("id", sermonId)
      }
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
  const sermon = up.sermon
  // The pre-run status of an EXISTING row (null for a brand-new one). On a failed
  // re-run, fail() restores this when it's a live state, so a transient failure
  // never strands a published/review service at 'failed'.
  priorSermonStatus = up.created ? null : sermon.status
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
  // Two modes, chosen per run (default 'api'):
  //   'api'     — call the metered Anthropic API now (the standard path).
  //   'session' — "Hold for Claude Code": assemble the EXACT prompt and park a
  //               segmentation_job for a Claude Code session to run; the
  //               /segment-finalize cron then completes it. No API spend, and the
  //               session works the CRM's own clean timestamped transcript.
  // Both modes converge on the same applySegmentation() + finalizeSegmentation,
  // so the persisted sermon is byte-identical either way. And an API run the
  // model can't fit (stop_reason: max_tokens on a long, unusual service) AUTO
  // falls back to the session path below rather than failing — a Claude Code
  // session has far more inference room, and the operator runs those anomalies
  // manually.
  await rec.start("segment")
  const segmentMode: "api" | "session" = opts.segmentMode ?? "api"
  const knownTopics = await fetchKnownTopics(admin)

  // Park the prepared prompt as a segmentation_job for a Claude Code session and
  // close the run clean. The session is ONLY the model: everything it needs
  // (system prompt, the timestamped transcript, the schema) is baked into the job
  // here, with zero CRM work on the session side and no API key required. Used by
  // 'session' mode and by the API max_tokens fallback.
  const handoffToSession = async (detail: string): Promise<RunResult> => {
    await admin.from("sermons").update({ status: "awaiting_segmentation", error: null }).eq("id", sermon.id)
    const enq = await enqueueSegmentationJob(admin, {
      sermonId: sermon.id,
      runId: run.id,
      videoId: video.videoId,
      timestamped,
      durationSec,
      knownTopics,
      userId,
      origin: opts.trigger === "manual" ? "manual" : "automatic",
    })
    if (!enq.ok) {
      await rec.finish("segment", "failed", { error: enq.error })
      return fail(sermon.id, enq.error)
    }
    await rec.finish("segment", "skipped", { detail: `${detail} (job ${enq.jobId})` })
    await admin
      .from("sermon_pipeline_runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString() })
      .eq("id", run.id)
    await logAudit({
      action: "sermon.run",
      actorUserId: userId,
      targetTable: "sermon_pipeline_runs",
      targetId: run.id,
      diff: { trigger: opts.trigger, step: "segment", mode: "session", jobId: enq.jobId, videoId: video.videoId, detail },
    })
    return {
      ok: true,
      runId: run.id,
      sermonId: sermon.id,
      videoId: video.videoId,
      status: "succeeded",
      steps: rec.current(),
      detail: "awaiting_segmentation",
    }
  }

  if (segmentMode === "session") {
    return handoffToSession("handed to Claude Code")
  }

  // ---- API mode (standard) ----
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
  const seg = await segmentSermon(timestamped, durationSec, knownTopics)
  if (!seg.ok) {
    // Anomaly fallback: the API couldn't fit the output — the model truncated
    // (adaptive thinking + the chapter JSON overran max_tokens) or declined the
    // length. Hand it to the limitless session path instead of failing the
    // service; the operator runs those manually. Any other failure (provider
    // outage, refusal, disabled) still fails the run for the monitor to surface.
    if (seg.reason === "provider_failed" && /max_tokens/i.test(seg.detail ?? "")) {
      return handoffToSession("API hit max_tokens; handed to Claude Code")
    }
    await rec.finish("segment", "failed", { error: `${seg.reason}${seg.detail ? `: ${seg.detail}` : ""}` })
    return fail(sermon.id, `segment_${seg.reason}`)
  }
  // A hand-kicked "Run now" is the manual auto-publish lane; cron + backfill are
  // automatic. applySegmentation reads the matching Settings toggle to decide
  // whether this lands at review or goes straight live.
  const applied = await applySegmentation(admin, sermon, seg.data, opts.trigger === "manual" ? "manual" : "automatic")
  if (!applied.ok) {
    await rec.finish("segment", "failed", { error: applied.error })
    return fail(sermon.id, applied.error)
  }
  await rec.finish("segment", "succeeded", {
    detail: `${seg.data.segments.length} chapters${seg.data.divergenceNote ? ` · divergence: ${seg.data.divergenceNote}` : ""}`,
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

// A pipeline run that has been 'running' longer than this is treated as
// orphaned: the serverless function that owned it timed out (Vercel caps the
// function at 300s) or crashed mid-step, so the run row will never close itself
// and its sermon is frozen at 'transcribing'/'segmenting'. The longest healthy
// run (a big service segmenting via the API) finishes comfortably under 5 min,
// so 8 min is a safe "nothing alive is still working on this" threshold.
const STUCK_RUN_THRESHOLD_MS = 8 * 60_000
// Cap the re-runs a single recovery tick kicks off, so a backlog of stuck runs
// can't blow the cron's own 300s budget. Marking orphaned runs failed +
// un-sticking sermons is cheap and unbounded; only the re-run (which re-fetches
// captions) is throttled. The rest are picked up on the next 2-min tick.
const RECOVER_RERUN_CAP = 3

export type RecoverResult = {
  scanned: number
  recovered: Array<{ runId: string; sermonId: string | null; action: string }>
}

/**
 * Recover sermon pipeline runs orphaned by a function timeout or crash.
 *
 * This is the fix for the SOURCE of "the popup said failed but it still shows
 * running and segmenting." A long API segment call can run ~4-5 min; if Vercel's
 * 300s function limit (or any crash) kills the request mid-segment, the call
 * never returns — so neither the success path NOR the max_tokens auto-fallback
 * ever fires. The run row stays 'running' forever and the sermon is stranded at
 * 'segmenting'. Nothing self-heals it, because the code that would have is the
 * code that got killed.
 *
 * This sweep (run every 2 min by the segment-finalize cron) finds runs stuck
 * past STUCK_RUN_THRESHOLD_MS and heals both rows:
 *   - mark the dead run 'failed' (orphaned_timeout),
 *   - if the sermon already has chapters, segmentation actually landed before
 *     the timeout and only the run row failed to close -> promote to 'review',
 *   - if it died mid-segment ('segmenting', no chapters), auto-route it to the
 *     limitless Claude Code session path (force re-run, segmentMode 'session') —
 *     the SAME recovery a max_tokens overrun gets, since a timeout means the
 *     service was too big to finish inside the API/function window,
 *   - otherwise restore a sane resting status ('transcribed' if a transcript is
 *     saved, else 'detected') so a later run can finish it.
 *
 * Idempotent: each run is claimed with a status-gated update, so two overlapping
 * ticks can never double-recover the same run.
 */
export async function recoverStuckSermonRuns(): Promise<RecoverResult> {
  const admin = createSupabaseAdminClient()
  const cutoff = new Date(Date.now() - STUCK_RUN_THRESHOLD_MS).toISOString()
  const { data: stuck } = await admin
    .from("sermon_pipeline_runs")
    .select("id, sermon_id, youtube_video_id, started_at")
    .eq("status", "running")
    .lt("started_at", cutoff)
    .order("started_at", { ascending: true })
    .limit(10)

  const recovered: RecoverResult["recovered"] = []
  let reruns = 0
  const FROZEN = new Set(["transcribing", "segmenting"])

  for (const r of stuck ?? []) {
    // Optimistic claim: only proceed if THIS tick flips it out of 'running', so
    // overlapping ticks (or a manual call racing the cron) can't double-recover.
    const { data: claimed } = await admin
      .from("sermon_pipeline_runs")
      .update({ status: "failed", error: "orphaned_timeout", finished_at: new Date().toISOString() })
      .eq("id", r.id)
      .eq("status", "running")
      .select("id")
      .maybeSingle()
    if (!claimed) continue // another tick already claimed it

    if (!r.sermon_id) {
      recovered.push({ runId: r.id, sermonId: null, action: "run failed (no sermon attached)" })
      continue
    }
    const { data: sermon } = await admin
      .from("sermons")
      .select("id, status, transcript, segments, youtube_video_id")
      .eq("id", r.sermon_id)
      .maybeSingle()
    if (!sermon) {
      recovered.push({ runId: r.id, sermonId: r.sermon_id, action: "run failed (sermon gone)" })
      continue
    }

    // Only heal a sermon that's genuinely frozen mid-pipeline. If it already
    // moved on (review/published/awaiting_segmentation/...), the run row was
    // merely stale — leave the sermon untouched.
    if (!FROZEN.has(sermon.status)) {
      recovered.push({ runId: r.id, sermonId: sermon.id, action: `run failed (sermon ${sermon.status}, left as-is)` })
      continue
    }

    const hasChapters = ((sermon.segments as SermonSegment[] | null) ?? []).length > 0
    if (hasChapters) {
      // Segmentation finished; only the run row failed to close. Promote it.
      await admin.from("sermons").update({ status: "review", error: null }).eq("id", sermon.id)
      recovered.push({ runId: r.id, sermonId: sermon.id, action: "promoted to review (chapters already present)" })
      continue
    }

    if (sermon.status === "segmenting" && reruns < RECOVER_RERUN_CAP) {
      // Died mid-segment with nothing written: the API call was killed by the
      // function timeout. Route to the limitless session path (same as a
      // max_tokens overrun). The force re-run re-fetches the timestamped
      // transcript and parks a segmentation_job; the finalize cron completes it.
      // Awaited (not fire-and-forget) so it can't be killed by the cron function
      // returning; session mode makes no API segment call, so it can't time out.
      reruns++
      await runSermonPipeline({
        trigger: "cron",
        videoId: sermon.youtube_video_id,
        force: true,
        segmentMode: "session",
      })
      recovered.push({ runId: r.id, sermonId: sermon.id, action: "re-run via Claude Code session (segment timeout)" })
      continue
    }

    // Mid-transcribe, or we've hit the per-tick re-run cap: restore a sane
    // resting status so the monitor is honest and a later run can finish it.
    const restore = sermon.transcript ? "transcribed" : "detected"
    await admin.from("sermons").update({ status: restore, error: null }).eq("id", sermon.id)
    recovered.push({ runId: r.id, sermonId: sermon.id, action: `restored to ${restore}` })
  }

  if (recovered.length > 0) {
    await logAudit({
      action: "sermon.run",
      actorUserId: null,
      targetTable: "sermon_pipeline_runs",
      targetId: recovered[0].runId,
      diff: { recovery: "stuck_runs", scanned: (stuck ?? []).length, recovered },
    })
  }

  return { scanned: (stuck ?? []).length, recovered }
}

export type PublishResult = { ok: true; id: string } | { ok: false; error: string }

/** Publish a reviewed sermon: it becomes visible on ms.church via the feed. */
export async function publishSermon(id: string, userId: string): Promise<PublishResult> {
  const admin = createSupabaseAdminClient()
  const { data: row, error } = await admin.from("sermons").select("*").eq("id", id).maybeSingle()
  if (error || !row) return { ok: false, error: "not_found" }
  // Publishable = has chapters. The transcript is supplemental (it only enriches
  // the single-sermon feed response + on-site transcript view); many good live
  // services have none, so requiring it here wrongly blocked publishing a fully
  // segmented service. Chapters are what the public watch page actually renders.
  if (((row.segments as SermonSegment[] | null) ?? []).length === 0) {
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
