import "server-only"
import type { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { Tables } from "@/lib/database.types"
import type { SegmentResult } from "@/server/ai/segmentContract"

/**
 * Shared application of a FINALIZED segmentation onto a sermon row. Single source
 * of truth so the two callers can never drift:
 *   - the live API path (runSermonPipeline, after segmentSermon)
 *   - the out-of-band finalize path (finalizeReturnedSegmentationJobs, after a
 *     Claude Code session hands back raw JSON the CRM then finalizes)
 *
 * `data` is already the post-`finalizeSegmentation` shape (gap-free, in-bounds
 * boundaries), so this only writes; it does no repair. The row lands at `review`
 * for a human to publish — we never auto-publish AI output to the live site.
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
  sermon: Pick<Sermon, "id" | "title" | "published_at" | "youtube_video_id">,
  data: FinalizedSegmentation,
): Promise<ApplyResult> {
  const slug = await uniqueSlug(admin, sermon.title, sermon.published_at, sermon.youtube_video_id, sermon.id)

  const { error: sErr } = await admin
    .from("sermons")
    .update({
      segments: data.segments as unknown as Sermon["segments"],
      summary: data.summary,
      seo: data.seo as unknown as Sermon["seo"],
      slug,
      status: "review",
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
  return { ok: true }
}
