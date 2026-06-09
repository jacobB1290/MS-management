/**
 * Shared email-attachment constants + helpers. Imported by both the server
 * upload route and the client composer, so keep it free of server-only and
 * browser-only top-level code.
 *
 * Email attachments are broader than MMS media (PDF/docs as well as images),
 * land in a PRIVATE Storage bucket (staff-only), and ride the email as real
 * Brevo attachments, not a public URL like MMS.
 */

/** Cap total attachment bytes at 25 MB for provider + storage headroom. */
export const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024
/** Per-file ceiling so one giant file can't eat the whole budget. */
export const MAX_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024
/** No more than this many files on a single email. */
export const MAX_ATTACHMENT_COUNT = 10

/** MIME → extension for the file types we accept as email attachments. */
export const ATTACHMENT_EXT_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
}

export const ACCEPTED_ATTACHMENT_TYPES = Object.keys(ATTACHMENT_EXT_BY_TYPE)

/** `accept` attribute for the email composer's <input type="file">. */
export const ATTACHMENT_ACCEPT_ATTR = ACCEPTED_ATTACHMENT_TYPES.join(",")

/** Metadata for an uploaded attachment, threaded from upload → send. */
export interface EmailAttachment {
  /** Storage object path (server-generated `<uuid>.<ext>`). */
  path: string
  filename: string
  type: string
  size: number
}

/** Upload one attachment through the staff-gated server route; returns its metadata. */
export async function uploadEmailAttachment(file: File): Promise<EmailAttachment> {
  const form = new FormData()
  form.set("file", file)
  const res = await fetch("/api/email/attachment", { method: "POST", body: form })
  const json = (await res.json().catch(() => null)) as
    | { path?: string; filename?: string; type?: string; size?: number; error?: string }
    | null
  if (!res.ok || !json?.path) {
    throw new Error(json?.error ?? `upload_failed_${res.status}`)
  }
  return {
    path: json.path,
    filename: json.filename ?? file.name,
    type: json.type ?? file.type,
    size: json.size ?? file.size,
  }
}
