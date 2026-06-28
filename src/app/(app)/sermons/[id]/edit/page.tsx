import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { Badge } from "@/components/ui/badge"
import {
  sermonStatus,
  type SermonSegment,
  type SermonSong,
  type SermonFormat,
} from "../../types"
import { SermonEditor, type SermonEditorInitial } from "./sermon-editor"

export const metadata: Metadata = { title: "Edit service" }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SermonEditPage({ params }: PageProps) {
  await requireStaff()
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: sermon } = await supabase.from("sermons").select("*").eq("id", id).maybeSingle()
  if (!sermon) notFound()

  const seo = (sermon.seo ?? null) as { description: string; tags: string[] } | null
  const initial: SermonEditorInitial = {
    id: sermon.id,
    youtubeVideoId: sermon.youtube_video_id,
    title: sermon.title,
    generatedTitle: sermon.generated_title,
    format: (sermon.format === "discussion" ? "discussion" : "sermon") as SermonFormat,
    publishedAt: sermon.published_at,
    thumbnailUrl: sermon.thumbnail_url,
    durationSec: sermon.duration_sec,
    slug: sermon.slug,
    summary: sermon.summary,
    transcript: sermon.transcript,
    speakers: Array.isArray(sermon.speakers) ? sermon.speakers : [],
    topics: Array.isArray(sermon.topics) ? sermon.topics : [],
    seo: seo ? { description: seo.description ?? "", tags: Array.isArray(seo.tags) ? seo.tags : [] } : null,
    segments: (Array.isArray(sermon.segments) ? sermon.segments : []) as unknown as SermonSegment[],
    songs: (Array.isArray(sermon.songs) ? sermon.songs : []) as unknown as SermonSong[],
    status: sermon.status,
  }

  const status = sermonStatus(sermon.status)

  return (
    <DetailScaffold
      eyebrow="Edit service"
      title={sermon.generated_title || sermon.title}
      backHref={`/sermons/${sermon.id}`}
      backLabel="Back to service"
      meta={<Badge variant={status.variant}>{status.label}</Badge>}
      className="pb-0 md:pb-0"
    >
      <div className="pt-6">
        <SermonEditor initial={initial} />
      </div>
    </DetailScaffold>
  )
}
