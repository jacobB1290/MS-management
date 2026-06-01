import "server-only"
import { getAccessToken, GOOGLE_DRIVE_FOLDER_ID } from "./auth"
import { publicImageUrl } from "./eventMapping"

/**
 * Google Drive v3 client for the flyer image that backs a calendar event's
 * attachment. On publish we upload the image (multipart), share it publicly
 * (anyone-with-link reader) so the public site + the lh3 render URL can load
 * it, and return the file id. Degrades to a mock id when OAuth is absent.
 *
 * The file is created AS the church Google account (via OAuth), so it lives in
 * that account's own Drive and shares cleanly — no service-account quota or
 * ownership headaches.
 */

const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
const FILES_URL = "https://www.googleapis.com/drive/v3/files"

const MOCK_PREFIX = "MOCKDRIVE_"

export type DriveUploadResult =
  | { ok: true; fileId: string; publicUrl: string; mock: boolean }
  | { ok: false; error: string }

/** Upload image bytes to Drive, make them public, return id + render URL. */
export async function uploadDriveImage(input: {
  bytes: Uint8Array
  mimeType: string
  name: string
}): Promise<DriveUploadResult> {
  const token = await getAccessToken()
  if (!token) {
    const fake = `${MOCK_PREFIX}${crypto.randomUUID()}`
    return { ok: true, fileId: fake, publicUrl: publicImageUrl(fake), mock: true }
  }

  const metadata: Record<string, unknown> = { name: input.name }
  if (GOOGLE_DRIVE_FOLDER_ID) metadata.parents = [GOOGLE_DRIVE_FOLDER_ID]

  // Hand-build the multipart/related body: a JSON metadata part + the binary.
  const boundary = `mschurch_${crypto.randomUUID()}`
  const enc = new TextEncoder()
  const head = enc.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${input.mimeType}\r\n\r\n`,
  )
  const tail = enc.encode(`\r\n--${boundary}--`)
  const body = new Uint8Array(head.length + input.bytes.length + tail.length)
  body.set(head, 0)
  body.set(input.bytes, head.length)
  body.set(tail, head.length + input.bytes.length)

  const uploadUrl = new URL(UPLOAD_URL)
  uploadUrl.searchParams.set("uploadType", "multipart")
  uploadUrl.searchParams.set("fields", "id")
  if (GOOGLE_DRIVE_FOLDER_ID) uploadUrl.searchParams.set("supportsAllDrives", "true")

  const res = await fetch(uploadUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    return { ok: false, error: `drive_upload_failed: ${res.status} ${text}`.trim() }
  }
  const { id } = (await res.json()) as { id: string }

  // Share publicly so the website (and the lh3 URL) can hotlink the image.
  const permRes = await fetch(`${FILES_URL}/${id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  })
  if (!permRes.ok) {
    const text = await permRes.text().catch(() => "")
    // Best-effort cleanup so we don't leave a private orphan the site can't show.
    await deleteDriveFile(id).catch(() => {})
    return { ok: false, error: `drive_share_failed: ${permRes.status} ${text}`.trim() }
  }

  return { ok: true, fileId: id, publicUrl: publicImageUrl(id), mock: false }
}

/** Delete a Drive file (idempotent; no-op for mock ids and 404s). */
export async function deleteDriveFile(
  fileId: string,
): Promise<{ ok: boolean; error?: string; mock?: boolean }> {
  if (fileId.startsWith(MOCK_PREFIX)) return { ok: true, mock: true }
  const token = await getAccessToken()
  if (!token) return { ok: true, mock: true }
  const res = await fetch(`${FILES_URL}/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "")
    return { ok: false, error: `drive_delete_failed: ${res.status} ${text}`.trim() }
  }
  return { ok: true, mock: false }
}
