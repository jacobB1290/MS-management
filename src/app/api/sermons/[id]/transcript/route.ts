import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { fetchTranscript, hasCaptionAccess } from "@/server/youtube/captions"

/**
 * Staff-only: re-download the service's YouTube captions and return both the
 * plain transcript and the TIMESTAMPED one the segmenter feeds the model, so
 * staff can copy either from the sermon detail page and verify segmentation
 * against the exact LLM input. It re-downloads on demand using the same
 * fetchTranscript path the pipeline uses (the timestamped form is built in
 * memory at run time and not persisted), so it works for every sermon, old or
 * new, and is byte-identical to what the model received.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireStaff()
  const { id } = await params

  const supabase = await createSupabaseServerClient()
  const { data: sermon } = await supabase
    .from("sermons")
    .select("youtube_video_id")
    .eq("id", id)
    .maybeSingle()
  if (!sermon) return NextResponse.json({ error: "not_found" }, { status: 404 })

  if (!hasCaptionAccess()) {
    return NextResponse.json({ error: "no_access" }, { status: 503 })
  }

  const res = await fetchTranscript(sermon.youtube_video_id)
  if (!res.ok) {
    return NextResponse.json(
      { error: res.reason, detail: res.detail ?? null },
      { status: 502 },
    )
  }

  return NextResponse.json(
    { ok: true, plain: res.transcript.plainText, timestamped: res.transcript.timestamped },
    { headers: { "Cache-Control": "no-store" } },
  )
}
