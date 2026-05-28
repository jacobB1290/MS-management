import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import { ATTACHMENT_EXT_BY_TYPE, MAX_ATTACHMENT_FILE_BYTES } from "@/lib/email-attachments"

/**
 * Email attachment upload. Staff-gated; the file is written to the PRIVATE
 * `email-attachments` bucket via the service-role key (the browser never
 * touches storage directly, and the bucket is never publicly readable — the
 * send path reads it back server-side and rides it as a real SendGrid
 * attachment). The object name is a random UUID. Returns metadata only (path,
 * filename, type, size) — never a URL.
 */
const BUCKET = "email-attachments"

export async function POST(request: NextRequest) {
  const user = await requireStaff()

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 })
  }

  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no_file" }, { status: 400 })
  }
  const ext = ATTACHMENT_EXT_BY_TYPE[file.type]
  if (!ext) {
    return NextResponse.json({ error: "unsupported_type", detail: file.type }, { status: 415 })
  }
  if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 })
  }

  const path = `${crypto.randomUUID()}.${ext}`
  const admin = createSupabaseAdminClient()
  const { error } = await admin.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) {
    return NextResponse.json({ error: "upload_failed", detail: error.message }, { status: 500 })
  }

  await logAudit({
    action: "media.upload",
    actorUserId: user.id,
    targetTable: "storage.objects",
    targetId: path,
    diff: { bucket: BUCKET, type: file.type, size: file.size },
  })
  return NextResponse.json({
    ok: true,
    path,
    // The original filename is what the recipient sees; sanitize to a safe label.
    filename: file.name.replace(/[\r\n"]/g, "").slice(0, 255) || `attachment.${ext}`,
    type: file.type,
    size: file.size,
  })
}
