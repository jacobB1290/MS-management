import type { Metadata } from "next"
import { Suspense } from "react"
import { requireStaff } from "@/server/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
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

  if (!selectedId) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <EmptyState
          icon={<Inbox size={32} className="text-ink-faint" />}
          title="No conversation selected"
          body="Pick a contact on the left to see the thread. New inbound messages will appear here as they arrive."
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <Suspense fallback={<ThreadSkeleton />} key={selectedId}>
        <ThreadLoader contactId={selectedId} currentUserId={user.id} />
      </Suspense>
      <div className="hidden lg:flex w-80 shrink-0 border-l border-ink-hairline bg-surface flex-col min-h-0">
        <Suspense fallback={<ContactPanelSkeleton />} key={selectedId}>
          <ContactPanelLoader contactId={selectedId} />
        </Suspense>
      </div>
    </div>
  )
}

async function ThreadLoader({
  contactId,
  currentUserId,
}: {
  contactId: string
  currentUserId: string
}) {
  const supabase = await createSupabaseServerClient()
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
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <ThreadPane
        contact={contactRes.data}
        initialMessages={messagesRes.data ?? []}
        currentUserId={currentUserId}
      />
    </div>
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

function ThreadSkeleton() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 px-4 md:px-6 py-3 border-b border-ink-hairline flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-pill" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="flex-1 px-4 md:px-8 py-6 space-y-4 overflow-hidden">
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
