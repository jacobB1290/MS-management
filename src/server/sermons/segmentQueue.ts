import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { Json } from "@/lib/database.types"
import { logAudit } from "@/server/audit"
import {
  SYSTEM_PROMPT,
  JSON_SCHEMA,
  ResultSchema,
  buildSegmentUserContent,
  finalizeSegmentation,
} from "@/server/ai/segmentContract"
import { applySegmentation } from "./segmentApply"
import type { RunOrigin } from "./config"

/**
 * "Claude Code as the model", wired as a handoff queue (CLAUDE.md §13.3 + the
 * 0043 migration). The CRM owns transcribe (clean per-cue timestamps) + prompt
 * assembly (segmentContract) + finalize (boundary repair) + the sermon write; a
 * Claude Code session is ONLY the model — it reads a job, returns raw JSON,
 * hands it back. This is what fixed the quality gap: the session segments the
 * CRM's own `timestamped` transcript, not a lossy re-derivation.
 *
 *   enqueueSegmentationJob          (pipeline, mode 'session')  -> status 'pending'
 *   << session claims, returns raw JSON via the Supabase MCP >> -> 'returned'
 *   finalizeReturnedSegmentationJobs (pg_cron /segment-finalize) -> 'finalized'
 *                                                                  sermon 'review'
 *
 * Both paths run the IDENTICAL `finalizeSegmentation`, so a session-segmented
 * service is byte-for-byte what an API run would have produced.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>

export type EnqueueSegmentationParams = {
  sermonId: string
  runId: string | null
  videoId: string
  /** The CRM's timestamped ([mm:ss]) transcript — the accurate-boundary source. */
  timestamped: string
  durationSec: number
  knownTopics: string[]
  userId?: string | null
  /** The run's origin, stamped on the job so finalize can apply the right auto-publish toggle. */
  origin: RunOrigin
}

/**
 * Park a prepared segmentation for a session to run. Stores the EXACT prompt the
 * API path would send (assembled here from segmentContract) so the session does
 * zero setup: it reads system_prompt + user_content, returns JSON matching
 * json_schema. Returns the job id.
 */
export async function enqueueSegmentationJob(
  admin: Admin,
  params: EnqueueSegmentationParams,
): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("segmentation_jobs")
    .insert({
      sermon_id: params.sermonId,
      run_id: params.runId,
      youtube_video_id: params.videoId,
      status: "pending",
      system_prompt: SYSTEM_PROMPT,
      user_content: buildSegmentUserContent(params.durationSec, params.knownTopics, params.timestamped),
      json_schema: JSON_SCHEMA as unknown as Json,
      duration_sec: params.durationSec,
      known_topics: params.knownTopics,
      created_by: params.userId ?? null,
      origin: params.origin,
    })
    .select("id")
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? "enqueue_failed" }
  return { ok: true, jobId: data.id }
}

export type FinalizeDrainResult = {
  scanned: number
  finalized: number
  errored: number
  details: { jobId: string; sermonId: string; status: "finalized" | "error"; detail?: string }[]
}

/**
 * Apply every `returned` job: validate the session's raw JSON, run the SAME
 * boundary-repair the API path runs, write the sermon → `review`, mark the job
 * `finalized`. Called by the /segment-finalize cron every 2 min. Never throws —
 * a bad result marks that one job `error` and is surfaced; the rest proceed.
 *
 * Each job is claimed optimistically (`status='returned'` guard) so overlapping
 * ticks can't double-apply: only one UPDATE flips the row out of 'returned'.
 */
export async function finalizeReturnedSegmentationJobs(limit = 10): Promise<FinalizeDrainResult> {
  const admin = createSupabaseAdminClient()
  const out: FinalizeDrainResult = { scanned: 0, finalized: 0, errored: 0, details: [] }

  const { data: jobs } = await admin
    .from("segmentation_jobs")
    .select("id, sermon_id, run_id, duration_sec, result, origin")
    .eq("status", "returned")
    .order("returned_at", { ascending: true })
    .limit(limit)
  if (!jobs || jobs.length === 0) return out

  for (const job of jobs) {
    out.scanned++
    const markError = async (detail: string) => {
      await admin
        .from("segmentation_jobs")
        .update({ status: "error", error: detail })
        .eq("id", job.id)
        .eq("status", "returned")
      out.errored++
      out.details.push({ jobId: job.id, sermonId: job.sermon_id, status: "error", detail })
    }

    try {
      // Validate + repair, exactly like segmentSermon's tail.
      const checked = ResultSchema.safeParse(job.result)
      if (!checked.success) {
        await markError(`schema: ${checked.error.issues[0]?.message ?? "invalid result"}`)
        continue
      }
      const finalized = finalizeSegmentation(checked.data, job.duration_sec)

      // Claim: only one tick wins the row out of 'returned'.
      const { data: claimed } = await admin
        .from("segmentation_jobs")
        .update({ status: "finalized", finalized_at: new Date().toISOString(), error: null })
        .eq("id", job.id)
        .eq("status", "returned")
        .select("id")
        .maybeSingle()
      if (!claimed) continue // lost the race

      const { data: sermon } = await admin
        .from("sermons")
        .select("id, title, published_at, youtube_video_id, created_by")
        .eq("id", job.sermon_id)
        .maybeSingle()
      if (!sermon) {
        await admin.from("segmentation_jobs").update({ status: "error", error: "sermon_not_found" }).eq("id", job.id)
        out.errored++
        out.details.push({ jobId: job.id, sermonId: job.sermon_id, status: "error", detail: "sermon_not_found" })
        continue
      }

      const applied = await applySegmentation(admin, sermon, finalized, (job.origin as RunOrigin) ?? "automatic")
      if (!applied.ok) {
        await admin.from("segmentation_jobs").update({ status: "error", error: applied.error }).eq("id", job.id)
        out.errored++
        out.details.push({ jobId: job.id, sermonId: job.sermon_id, status: "error", detail: applied.error })
        continue
      }

      await logAudit({
        action: "sermon.segment",
        actorUserId: null,
        targetTable: "sermons",
        targetId: sermon.id,
        diff: {
          source: "session_segmentation_job",
          jobId: job.id,
          chapters: finalized.segments.length,
          ...(finalized.divergenceNote ? { divergence: finalized.divergenceNote } : {}),
        },
      })
      out.finalized++
      out.details.push({ jobId: job.id, sermonId: job.sermon_id, status: "finalized" })
    } catch (err) {
      await markError(err instanceof Error ? err.message : String(err))
    }
  }

  return out
}
