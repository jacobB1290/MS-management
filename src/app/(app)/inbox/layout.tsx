import { Suspense } from "react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { InboxFrame } from "./inbox-frame"
import { ConversationList } from "./conversation-list"
import { ConversationListSkeleton } from "./conversation-list-skeleton"

/**
 * Inbox shell. The conversation list lives here, not in page.tsx, so it loads
 * ONCE per inbox visit and survives every ?c= change — switching threads never
 * re-fetches the list. It streams in as a Suspense slot: tapping the Inbox tab
 * paints the frame + rail skeleton immediately instead of blocking the whole
 * route on the contact_summary read. Realtime keeps it fresh after that.
 */
export default function InboxLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <InboxFrame
      list={
        <Suspense fallback={<ConversationListSkeleton />}>
          <ConversationsLoader />
        </Suspense>
      }
    >
      {children}
    </InboxFrame>
  )
}

async function ConversationsLoader() {
  const supabase = await createSupabaseServerClient()
  const { data: conversations } = await supabase
    .from("contact_summary")
    .select(
      "id, name, phone, email, tags, sms_opted_out_at, email_unsubscribed_at, is_member, inbox_category, inbox_status, last_message_at, last_message_body, last_message_direction, last_message_channel, message_count",
    )
    // Only contacts with at least one message belong in the inbox. A freshly
    // added contact has no thread yet; it appears here once something is sent
    // or received (last_message_at becomes non-null).
    .not("last_message_at", "is", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200)

  return <ConversationList conversations={conversations ?? []} />
}
