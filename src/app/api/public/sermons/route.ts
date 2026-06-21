import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { Tables } from "@/lib/database.types"
import type { SermonSegment } from "@/server/ai/segmentSermon"

/**
 * Public, read-only feed of PUBLISHED sermons for ms.church to render (chaptered
 * transcript + VideoObject schema). This is the only sermon data that leaves the
 * CRM, and only published rows are ever exposed — never drafts, transcripts in
 * review, or pipeline internals. Read via the service-role client (RLS-exempt)
 * but hard-filtered to status='published', so anon never sees unpublished work.
 *
 * GET /api/public/sermons            -> list (newest first, capped)
 * GET /api/public/sermons?slug=<x>   -> single sermon with full transcript
 *
 * CORS open (the content is public the moment it's published) and edge-cached.
 */

export const dynamic = "force-dynamic"

type Row = Tables<"sermons">

type PublicSermon = {
  slug: string
  youtubeVideoId: string
  title: string
  publishedAt: string | null
  thumbnailUrl: string | null
  durationSec: number | null
  summary: string | null
  seo: { description: string; tags: string[] } | null
  segments: SermonSegment[]
  /** Full transcript only included in the single-sermon (slug) response. */
  transcript?: string | null
}

function toPublic(row: Row, includeTranscript: boolean): PublicSermon {
  const segments = (Array.isArray(row.segments) ? row.segments : []) as unknown as SermonSegment[]
  const seo = (row.seo ?? null) as PublicSermon["seo"]
  return {
    slug: row.slug ?? row.youtube_video_id,
    youtubeVideoId: row.youtube_video_id,
    title: row.title,
    publishedAt: row.published_at,
    thumbnailUrl: row.thumbnail_url,
    durationSec: row.duration_sec,
    summary: row.summary,
    seo,
    segments,
    ...(includeTranscript ? { transcript: row.transcript } : {}),
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}
const CACHE = "public, s-maxage=300, stale-while-revalidate=86400"

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  const admin = createSupabaseAdminClient()
  const slug = new URL(request.url).searchParams.get("slug")

  if (slug) {
    const { data, error } = await admin
      .from("sermons")
      .select("*")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle()
    if (error) return NextResponse.json({ error: "feed_error" }, { status: 502, headers: CORS })
    if (!data) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS })
    return NextResponse.json(
      { sermon: toPublic(data, true) },
      { headers: { ...CORS, "Cache-Control": CACHE } },
    )
  }

  const { data, error } = await admin
    .from("sermons")
    .select("*")
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(50)
  if (error) return NextResponse.json({ error: "feed_error" }, { status: 502, headers: CORS })

  return NextResponse.json(
    { sermons: (data ?? []).map((r) => toPublic(r, false)) },
    { headers: { ...CORS, "Cache-Control": CACHE } },
  )
}
