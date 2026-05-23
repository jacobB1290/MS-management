import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { isVideoUrl } from "@/lib/media"

/**
 * Storage manager backend for the mms-media bucket. Listing + deleting go
 * through the service-role client (the bucket is public for reads, but
 * listing and removing are privileged). Names are always `<uuid>.<ext>`.
 */
const BUCKET = "mms-media"

export type StoredMedia = {
  name: string
  url: string
  size: number
  createdAt: string | null
  isVideo: boolean
}

export async function listMmsMedia(): Promise<{ files: StoredMedia[]; totalBytes: number }> {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.storage.from(BUCKET).list("", {
    limit: 1000,
    sortBy: { column: "created_at", order: "desc" },
  })
  if (error || !data) return { files: [], totalBytes: 0 }

  const files: StoredMedia[] = []
  let totalBytes = 0
  for (const obj of data) {
    if (obj.id === null) continue // folder/prefix placeholder, not a file
    const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0)
    totalBytes += size
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(obj.name)
    files.push({
      name: obj.name,
      url: pub.publicUrl,
      size,
      createdAt: obj.created_at ?? null,
      isVideo: isVideoUrl(obj.name),
    })
  }
  return { files, totalBytes }
}

export async function deleteMmsMedia(name: string): Promise<{ ok: boolean; error?: string }> {
  // Names are server-generated `<uuid>.<ext>`; reject anything else to block
  // path traversal or deleting outside the flat bucket root.
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(name)) return { ok: false, error: "invalid_name" }
  const admin = createSupabaseAdminClient()
  const { error } = await admin.storage.from(BUCKET).remove([name])
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
