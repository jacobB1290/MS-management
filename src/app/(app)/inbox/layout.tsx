import { createSupabaseServerClient } from "@/lib/supabase/server"
import { InboxFrame } from "./inbox-frame"

/**
 * Inbox shell. The conversation list lives here, not in page.tsx, so it
 * loads ONCE per inbox visit and survives every ?c= change — switching
 * threads no longer re-fetches the list. Realtime keeps it fresh in the
 * background.
 */
export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServerClient()
  const { data: conversations } = await supabase
    .from("contact_summary")
    .select(
      "id, name, phone, email, tags, sms_opted_out_at, email_unsubscribed_at, last_message_at, last_message_body, last_message_direction, message_count",
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200)

  return <InboxFrame conversations={conversations ?? []}>{children}</InboxFrame>
}
