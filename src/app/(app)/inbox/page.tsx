import type { Metadata } from "next"
import { Suspense } from "react"
import { requireStaff } from "@/server/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { ConversationList } from "./conversation-list"
import { ThreadPane } from "./thread-pane"
import { ContactPanel } from "./contact-panel"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Inbox } from "lucide-react"

export const metadata: Metadata = { title: "Inbox" }

interface InboxPageProps {
  searchParams: Promise<{ c?: string }>
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const user = await requireStaff()
  const { c: selectedId } = await searchParams

  return (
    <div className="flex h-[calc(100dvh-58px)] md:h-dvh">
      <div
        className={`${selectedId ? "hidden lg:flex" : "flex"} w-full lg:w-80 xl:w-96 shrink-0 flex-col border-r border-ink-hairline bg-surface`}
      >
        <Suspense fallback={<ConversationListSkeleton />}>
          <ConversationListLoader selectedId={selectedId} />
        </Suspense>
      </div>

      <div
        className={`${selectedId ? "flex" : "hidden lg:flex"} flex-1 min-w-0 flex-col`}
      >
        {selectedId ? (
          <Suspense fallback={<ThreadSkeleton />} key={selectedId}>
            <ThreadLoader contactId={selectedId} currentUserId={user.id} />
          </Suspense>
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
        {selectedId && (
          <Suspense fallback={<ContactPanelSkeleton />} key={selectedId}>
            <ContactPanelLoader contactId={selectedId} />
          </Suspense>
        )}
      </div>
    </div>
  )
}

/* Each loader is its own async boundary so the shell paints instantly and the
 * three panes stream in independently. With Vercel pinned to sfo1 and Supabase
 * in us-west-1, individual queries are now sub-30ms. */

async function ConversationListLoader({ selectedId }: { selectedId?: string }) {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("contact_summary")
    .select(
      "id, name, phone, email, tags, sms_opted_out_at, email_unsubscribed_at, last_message_at, last_message_body, last_message_direction, message_count",
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200)
  return <ConversationList conversations={data ?? []} selectedId={selectedId} />
}

async function ThreadLoader({
  contactId,
  currentUserId,
}: {
  contactId: string
  currentUserId: string
}) {
  const supabase = await createSupabaseServerClient()
  // Parallel — both queries hit the same region, no reason to serialize.
  const [contactRes, messagesRes] = await Promise.all([
    supabase.from("contacts").select("*").eq("id", contactId).maybeSingle(),
    supabase
      .from("messages")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: true })
      .limit(500),
  ])
  if (!contactRes.data) return null
  return (
    <ThreadPane
      contact={contactRes.data}
      initialMessages={messagesRes.data ?? []}
      currentUserId={currentUserId}
    />
  )
}

async function ContactPanelLoader({ contactId }: { contactId: string }) {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle()
  if (!data) return null
  return <ContactPanel contact={data} />
}

function ConversationListSkeleton() {
  return (
    <div className="px-4 pt-5 pb-3 space-y-3">
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-11 w-full" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  )
}

function ThreadSkeleton() {
  return (
    <div className="flex-1 flex flex-col">
      <div className="shrink-0 px-4 md:px-6 py-3 border-b border-ink-hairline flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-pill" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="flex-1 px-4 md:px-8 py-6 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={i % 2 === 0 ? "flex justify-start" : "flex justify-end"}>
            <Skeleton className="h-12 w-2/3 max-w-md rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ContactPanelSkeleton() {
  return (
    <div className="flex-1 p-6 space-y-4">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-6 w-3/4" />
      <div className="space-y-3 pt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  )
}
