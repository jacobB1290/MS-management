import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

/**
 * MMS media upload. Staff-gated; the file is written to the public `mms-media`
 * bucket via the service-role key (the browser never touches storage
 * directly). Returns the public URL — Twilio fetches media from a public
 * HTTPS URL, and the object name is a random UUID so the URL isn't guessable.
 */
const BUCKET = "mms-media"
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB; matches the bucket + Twilio's ceiling
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
}

export async function POST(request: NextRequest) {
  await requireStaff()

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
  const ext = EXT_BY_TYPE[file.type]
  if (!ext) {
    return NextResponse.json({ error: "unsupported_type", detail: file.type }, { status: 415 })
  }
  if (file.size > MAX_BYTES) {
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

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ ok: true, url: data.publicUrl, path })
}
