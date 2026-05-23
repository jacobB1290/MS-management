import "server-only"
import webpush from "web-push"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

export type PushPayload = {
  title: string
  body: string
  url?: string
  /** Collapses repeat notifications from the same source (e.g. one contact). */
  tag?: string
}

type SubRow = { endpoint: string; p256dh: string; auth: string }

let configured: boolean | null = null

/** Lazily wire up VAPID. Returns false (and disables sending) when keys are
 *  absent, so the app runs fine in dev/demo without push configured. */
function configure(): boolean {
  if (configured !== null) return configured
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || "mailto:hello@morningstarchurchboise.org"
  if (!publicKey || !privateKey) {
    configured = false
    return false
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
  return true
}

async function deliver(rows: SubRow[], payload: PushPayload): Promise<void> {
  const body = JSON.stringify(payload)
  const admin = createSupabaseAdminClient()
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body,
          { TTL: 60 * 60 * 24, urgency: "high" },
        )
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode?: unknown }).statusCode)
            : 0
        // 404/410 mean the subscription is gone — prune it so we stop trying.
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", row.endpoint)
        }
      }
    }),
  )
}

/** Notify every staff device (optionally excluding one user, e.g. the sender). */
export async function sendPushToStaff(
  payload: PushPayload,
  opts?: { exceptUserId?: string },
): Promise<void> {
  if (!configure()) return
  const admin = createSupabaseAdminClient()
  let query = admin.from("push_subscriptions").select("endpoint, p256dh, auth")
  if (opts?.exceptUserId) query = query.neq("user_id", opts.exceptUserId)
  const { data } = await query
  if (!data || data.length === 0) return
  await deliver(data as SubRow[], payload)
}

/** Notify a single staffer's devices. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!configure()) return
  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId)
  if (!data || data.length === 0) return
  await deliver(data as SubRow[], payload)
}
