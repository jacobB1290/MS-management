import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "contact.create"
  | "contact.update"
  | "contact.delete"
  | "contact.opt_out_sms"
  | "contact.opt_in_sms"
  | "contact.unsubscribe_email"
  | "message.send"
  | "message.send_failed"
  | "call.start"
  | "campaign.create"
  | "campaign.update"
  | "campaign.start"
  | "campaign.cancel"
  | "form.submitted"
  | "media.upload"
  | "media.delete"
  | "webhook.twilio.inbound"
  | "webhook.sendgrid.event"
  | "user.invite"
  | "user.role_change"
  | "settings.ai_update"
  | "contact.inbox_triage"
  | "contact.inbox_update"

/**
 * Append an audit log entry. Reads aren't audited; the threat is unauthorized
 * writes. Always called server-side with the service-role client (which
 * bypasses RLS); the table is read-only for admins via policy.
 */
export async function logAudit(entry: {
  action: AuditAction
  actorUserId?: string | null
  targetTable?: string | null
  targetId?: string | null
  diff?: unknown
  ip?: string | null
  userAgent?: string | null
}): Promise<void> {
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from("audit_log").insert({
    action: entry.action,
    actor_user_id: entry.actorUserId ?? null,
    target_table: entry.targetTable ?? null,
    target_id: entry.targetId ?? null,
    diff: (entry.diff ?? null) as never,
    ip: (entry.ip ?? null) as never,
    user_agent: entry.userAgent ?? null,
  })
  if (error) {
    // Don't throw — audit failures shouldn't break the user action.
    // Log to stderr so observability picks it up.
    console.error("[audit] insert failed:", error.message, entry)
  }
}
