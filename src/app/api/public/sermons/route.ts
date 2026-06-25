import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { Tables } from "@/lib/database.types"
import type { SermonSegment, SermonFormat, SermonSong } from "@/server/ai/segmentSermon"

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
  /** 'sermon' (one preacher) or 'discussion' (two hosts) — drives the site's tabs. */
  format: SermonFormat
  /** The preacher, or the two hosts, named when stated. */
  speakers: string[]
  /** Self-managing topic keywords — the site's filter chips + topic pages. */
  topics: string[]
  publishedAt: string | null
  thumbnailUrl: string | null
  durationSec: number | null
  summary: string | null
  seo: { description: string; tags: string[] } | null
  segments: SermonSegment[]
  /** Individual worship songs (title + who + bounds) for the Songs library. */
  songs: SermonSong[]
  /** Full transcript only included in the single-sermon (slug) response. */
  transcript?: string | null
}

function toPublic(row: Row, includeTranscript: boolean): PublicSermon {
  const segments = (Array.isArray(row.segments) ? row.segments : []) as unknown as SermonSegment[]
  const songs = (Array.isArray(row.songs) ? row.songs : []) as unknown as SermonSong[]
  const seo = (row.seo ?? null) as PublicSermon["seo"]
  return {
    slug: row.slug ?? row.youtube_video_id,
    youtubeVideoId: row.youtube_video_id,
    // The public title is the AI-generated, descriptive one; fall back to the
    // raw YouTube livestream title for a service not re-run since 0042.
    title: row.generated_title || row.title,
    format: row.format === "discussion" ? "discussion" : "sermon",
    speakers: Array.isArray(row.speakers) ? row.speakers : [],
    topics: Array.isArray(row.topics) ? row.topics : [],
    publishedAt: row.published_at,
    thumbnailUrl: row.thumbnail_url,
    durationSec: row.duration_sec,
    summary: row.summary,
    seo,
    segments,
    songs,
    ...(includeTranscript ? { transcript: row.transcript } : {}),
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}
// Short, bounded edge cache. ms.church fetches this server-side and layers its
// own caches on top, so a long SWR window here would pin a freshly published
// sermon out of the public feed for hours. 60s fresh + 120s SWR keeps the feed
// near-live while still absorbing bursts at the edge.
const CACHE = "public, s-maxage=60, stale-while-revalidate=120"

// How many published services the public feed returns (newest first). ms.church
// renders the WHOLE feed into one /watch page for SEO + client-side search, but
// shows only the first few per tab and reveals the rest behind a "Show more"
// button, so a large feed no longer means a heavy first paint. This was 50, which
// silently capped a growing archive (72 published as of 2026-06). 500 is a sanity
// bound (years of weekly services + any back-catalog backfill), not a display
// limit; raise it freely if the archive ever approaches it.
const PUBLIC_FEED_LIMIT = 500

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
    .limit(PUBLIC_FEED_LIMIT)
  if (error) return NextResponse.json({ error: "feed_error" }, { status: 502, headers: CORS })

  return NextResponse.json(
    { sermons: (data ?? []).map((r) => toPublic(r, false)) },
    { headers: { ...CORS, "Cache-Control": CACHE } },
  )
}
