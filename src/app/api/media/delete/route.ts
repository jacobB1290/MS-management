import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { deleteMmsMedia } from "@/server/media/storage"
import { logAudit } from "@/server/audit"

/**
 * Delete an MMS media object from the storage manager. Staff-gated; the
 * removal itself is a privileged write, so it's audited.
 */
export async function POST(request: NextRequest) {
  const user = await requireStaff()

  const json = (await request.json().catch(() => null)) as { name?: string } | null
  const name = json?.name
  if (!name) return NextResponse.json({ error: "no_name" }, { status: 400 })

  const result = await deleteMmsMedia(name)
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "delete_failed" }, { status: 400 })
  }

  await logAudit({
    action: "media.delete",
    actorUserId: user.id,
    targetTable: "storage.objects",
    targetId: name,
  })
  return NextResponse.json({ ok: true })
}
