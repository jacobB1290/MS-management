import { NextResponse, type NextRequest } from "next/server"
import { requireAdmin, requireStaff } from "@/server/auth"
import { deleteSermon } from "@/server/sermons/service"
import { EditSermonSchema, updateSermon } from "@/server/sermons/editSermon"

/**
 * Edit a service (staff). Writes every field the public site shows — title,
 * summary, speakers, topics, format, date, thumbnail, SEO, chapters, and songs —
 * letting a human fix anything the model left blank or got slightly wrong.
 * Editing a published service pulls it back to review until re-published.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params

  const parsed = EditSermonSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid_payload" },
      { status: 400 },
    )
  }

  const result = await updateSermon(id, parsed.data, user.id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 502 })
  }
  return NextResponse.json({ ok: true, id: result.id, status: result.status, slug: result.slug })
}

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
