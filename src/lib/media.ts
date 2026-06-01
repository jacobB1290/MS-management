/**
 * Shared MMS media constants + helpers. Imported by both the server upload
 * route and client composers, so keep it free of server-only and
 * browser-only top-level code.
 */

/** Twilio's practical MMS ceiling. Enforced here, in the route, and on the bucket. */
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024

/** MIME → extension for the media we accept: images + short video. */
export const MEDIA_EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
}

export const ACCEPTED_MEDIA_TYPES = Object.keys(MEDIA_EXT_BY_TYPE)

/** `accept` attribute for <input type="file">. */
export const MEDIA_ACCEPT_ATTR = ACCEPTED_MEDIA_TYPES.join(",")

/** Whether stored media is a video (vs image), keyed off the URL/name extension. */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|3gp|3gpp|mov|m4v|qt)(\?|#|$)/i.test(url)
}

/** Upload a file through the staff-gated server route; returns its public URL
 *  and the storage path (the path lets callers, e.g. the event editor, track
 *  the stored object). */
export async function uploadMedia(file: File): Promise<{ url: string; path: string }> {
  const form = new FormData()
  form.set("file", file)
  const res = await fetch("/api/media/upload", { method: "POST", body: form })
  const json = (await res.json().catch(() => null)) as
    | { url?: string; path?: string; error?: string }
    | null
  if (!res.ok || !json?.url) {
    throw new Error(json?.error ?? `upload_failed_${res.status}`)
  }
  return { url: json.url, path: json.path ?? "" }
}
