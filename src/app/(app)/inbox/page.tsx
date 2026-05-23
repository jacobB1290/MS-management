import type { Metadata } from "next"
import { requireStaff } from "@/server/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { ConversationList } from "./conversation-list"
import { ThreadPane } from "./thread-pane"
import { ContactPanel } from "./contact-panel"
import { EmptyState } from "@/components/ui/empty-state"
import { Inbox } from "lucide-react"

export const metadata: Metadata = { title: "Inbox" }

interface InboxPageProps {
  searchParams: Promise<{ c?: string }>
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const user = await requireStaff()
  const { c: selectedId } = await searchParams

  const supabase = await createSupabaseServerClient()

  const { data: conversations } = await supabase
    .from("contact_summary")
    .select(
      "id, name, phone, email, tags, sms_opted_out_at, email_unsubscribed_at, last_message_at, last_message_body, last_message_direction, message_count",
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200)

  const selected = selectedId
    ? (await supabase
        .from("contacts")
        .select("*")
        .eq("id", selectedId)
        .maybeSingle()).data
    : null

  const { data: messages } = selectedId
    ? await supabase
        .from("messages")
        .select("*")
        .eq("contact_id", selectedId)
        .order("created_at", { ascending: true })
        .limit(500)
    : { data: null }

  return (
    <div className="flex h-[calc(100dvh-58px)] md:h-dvh">
      {/* Mobile + tablet: show list OR thread (single-pane). Desktop ≥1024:
          show list and thread side-by-side. */}
      <div
        className={`${selectedId ? "hidden lg:flex" : "flex"} w-full lg:w-80 xl:w-96 shrink-0 flex-col border-r border-ink-hairline bg-surface`}
      >
        <ConversationList
          conversations={conversations ?? []}
          selectedId={selectedId}
        />
      </div>

      <div
        className={`${selectedId ? "flex" : "hidden lg:flex"} flex-1 min-w-0 flex-col`}
      >
        {selected ? (
          <ThreadPane
            contact={selected}
            initialMessages={messages ?? []}
            currentUserId={user.id}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <EmptyState
              icon={<Inbox size={32} className="text-ink-faint" />}
              title="No conversation selected"
              body="Pick a contact on the left to see the thread. New inbound messages will appear here as they arrive."
            />
          </div>
        )}
      </div>

      <div className="hidden lg:flex w-80 shrink-0 border-l border-ink-hairline bg-surface flex-col">
        {selected && <ContactPanel contact={selected} />}
      </div>
    </div>
  )
}
