import "server-only"
import type { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { Tables } from "@/lib/database.types"
import type { SegmentResult } from "@/server/ai/segmentContract"
import { logAudit } from "@/server/audit"
import { getSermonsConfig, landingStatusFor, type RunOrigin } from "./config"

/**
 * Shared application of a FINALIZED segmentation onto a sermon row. Single source
 * of truth so the two callers can never drift:
 *   - the live API path (runSermonPipeline, after segmentSermon)
 *   - the out-of-band finalize path (finalizeReturnedSegmentationJobs, after a
 *     Claude Code session hands back raw JSON the CRM then finalizes)
 *
 * `data` is already the post-`finalizeSegmentation` shape (gap-free, in-bounds
 * boundaries), so this only writes; it does no repair.
 *
 * Landing status: `review` by default, so a human publishes (publishing is what
 * puts a service on ms.church). The Settings → Services auto-publish modes can
 * send a completed run straight to `published` instead — `origin` says whether
 * the run was unattended (cron/backfill/session) or a hand-kicked "Run now", and
 * `landingStatusFor` applies the matching toggle. Both modes default off, so the
 * historical "always review" behavior holds until an admin opts in.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>
type Sermon = Tables<"sermons">
/** The finalized segmentation the model+repair produces (segmentContract). */
export type FinalizedSegmentation = Extract<SegmentResult, { ok: true }>["data"]

export function slugify(input: string): string {
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
export async function uniqueSlug(
  admin: Admin,
  title: string,
  publishedAt: string | null,
  videoId: string,
  selfId: string,
): Promise<string> {
  const base = `${slugify(title) || "service"}-${dateStamp(publishedAt)}`
  const { data } = await admin.from("sermons").select("id, slug").eq("slug", base).maybeSingle()
  if (!data || data.id === selfId) return base
  return `${base}-${videoId.slice(0, 6).toLowerCase()}`
}

export type ApplyResult = { ok: true } | { ok: false; error: string }

/**
 * Write a finalized segmentation onto the sermon row → status `review`. Mirrors
 * the writes the API path used inline before this extraction: the core result
 * (works on any schema version) plus the migration-0038 classification fields
 * (format/speakers/topics/songs) best-effort, so a not-yet-migrated database
 * still completes the sermon.
 */
export async function applySegmentation(
  admin: Admin,
  sermon: Pick<Sermon, "id" | "title" | "published_at" | "youtube_video_id" | "created_by">,
  data: FinalizedSegmentation,
  origin: RunOrigin = "automatic",
): Promise<ApplyResult> {
  const slug = await uniqueSlug(admin, sermon.title, sermon.published_at, sermon.youtube_video_id, sermon.id)

  const settings = await getSermonsConfig(admin)
  const status = landingStatusFor(origin, settings)
  // Publishing stamps published_at the first time (mirrors publishSermon). The
  // segments are guaranteed non-empty here, so the publish-readiness guard holds.
  const publishedAt = status === "published" ? (sermon.published_at ?? new Date().toISOString()) : sermon.published_at

  const { error: sErr } = await admin
    .from("sermons")
    .update({
      segments: data.segments as unknown as Sermon["segments"],
      summary: data.summary,
      seo: data.seo as unknown as Sermon["seo"],
      slug,
      status,
      published_at: publishedAt,
      error: null,
    })
    .eq("id", sermon.id)
  if (sErr) return { ok: false, error: sErr.message }

  const { error: cErr } = await admin
    .from("sermons")
    .update({
      generated_title: data.title,
      format: data.format,
      speakers: data.speakers,
      topics: data.topics,
      songs: data.songs as unknown as Sermon["segments"],
    })
    .eq("id", sermon.id)
  if (cErr) {
    console.error("sermon classification write failed (are migrations 0038/0040 applied?):", cErr.message)
  }

  // An auto-publish skipped the human review gate — record it. The actor is the
  // system (the run's creator, when known), so the audit trail shows a service
  // went live without a manual publish click.
  if (status === "published") {
    await logAudit({
      action: "sermon.auto_publish",
      actorUserId: sermon.created_by ?? null,
      targetTable: "sermons",
      targetId: sermon.id,
      diff: { origin, chapters: data.segments.length },
    })
  }
  return { ok: true }
}
