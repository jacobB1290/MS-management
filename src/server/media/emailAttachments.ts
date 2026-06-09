import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import {
  ATTACHMENT_EXT_BY_TYPE,
  MAX_ATTACHMENT_TOTAL_BYTES,
  type EmailAttachment,
} from "@/lib/email-attachments"

const BUCKET = "email-attachments"

/** A Brevo attachment payload: a filename plus base64-encoded bytes. */
export interface BrevoAttachment {
  name: string
  content: string
}

/** Lightweight metadata stored on the message row (no file bytes). */
export interface StoredAttachmentMeta {
  path: string
  filename: string
  type: string
  size: number
}

export type ResolveAttachmentsResult =
  | { ok: true; brevo: BrevoAttachment[]; meta: StoredAttachmentMeta[] }
  | { ok: false; reason: "invalid_name" | "unsupported_type" | "too_large" | "not_found"; detail?: string }

/**
 * Download the uploaded attachments from the PRIVATE bucket and base64-encode
 * them for Brevo's transactional `attachment` array, returning both the provider
 * payload and the slimmed metadata to persist on the message. Re-validates name,
 * type, and the total size cap server-side (the client cannot be trusted).
 * Returns empty arrays for no attachments.
 */
export async function resolveEmailAttachments(
  attachments: EmailAttachment[],
): Promise<ResolveAttachmentsResult> {
  if (attachments.length === 0) return { ok: true, brevo: [], meta: [] }

  const admin = createSupabaseAdminClient()
  const brevo: BrevoAttachment[] = []
  const meta: StoredAttachmentMeta[] = []
  let total = 0

  for (const a of attachments) {
    // Server-generated names only: `<uuid>.<ext>`. Blocks path traversal.
    if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(a.path)) {
      return { ok: false, reason: "invalid_name", detail: a.path }
    }
    if (!ATTACHMENT_EXT_BY_TYPE[a.type]) {
      return { ok: false, reason: "unsupported_type", detail: a.type }
    }

    const { data, error } = await admin.storage.from(BUCKET).download(a.path)
    if (error || !data) return { ok: false, reason: "not_found", detail: a.path }

    const bytes = Buffer.from(await data.arrayBuffer())
    total += bytes.byteLength
    if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
      return { ok: false, reason: "too_large" }
    }

    const filename = a.filename.replace(/[\r\n"]/g, "").slice(0, 255) || a.path
    brevo.push({ name: filename, content: bytes.toString("base64") })
    meta.push({ path: a.path, filename, type: a.type, size: bytes.byteLength })
  }

  return { ok: true, brevo, meta }
}
