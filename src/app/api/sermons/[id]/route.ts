import { NextResponse, type NextRequest } from "next/server"
import { requireAdmin } from "@/server/auth"
import { deleteSermon } from "@/server/sermons/service"

/**
 * Delete a sermon (admin only). Removes the CRM working copy + published record;
 * the YouTube video is untouched, so a later run can re-detect it as new.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin()
  const { id } = await params
  const result = await deleteSermon(id, user.id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true, id: result.id })
}
