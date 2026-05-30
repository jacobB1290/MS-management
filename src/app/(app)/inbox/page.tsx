import type { Metadata } from "next"
import { Suspense, cache } from "react"
import { requireStaff } from "@/server/auth"
import { isVoiceConfigured } from "@/server/comms/voice"
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server"
import { assertCanSendSms } from "@/server/comms/optOut"
import { resolveOptInMode } from "@/server/comms/optInMode"
import { ThreadPane } from "./thread-pane"
import { ContactPanel } from "./contact-panel"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Inbox } from "lucide-react"
import type { Tables } from "@/lib/database.types"

export const metadata: Metadata = { title: "Inbox" }

// The thread pane and the contact panel render as two separate Suspense
// children that both need the same contact and its opt-in mode. Request-scoped
// memoization collapses what used to be two identical contact reads (and two
// runs of the opt-in gate) into one per request — the page opens with a single
// round-trip for the row instead of several.
const loadContact = cache(async (id: string): Promise<Tables<"contacts"> | null> => {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle()
  return data
})
const loadOptInMode = cache((contact: Tables<"contacts">) => resolveOptInMode(contact))

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
      {/* No per-thread Suspense key: keeping one boundary lets React hold the
          current thread on screen while the next one streams in (the nav is a
          transition), so switching threads is seamless instead of flashing a
          skeleton every time. The very first open from the empty state is the
          only time the skeleton shows. ThreadPane resets its own state when the
          contact id changes. */}
      <Suspense fallback={<ThreadSkeleton />}>
        <ThreadLoader contactId={selectedId} currentUserId={user.id} />
      </Suspense>
      <div className="hidden lg:flex w-72 xl:w-80 shrink-0 border-l border-ink-hairline bg-surface flex-col min-h-0">
        <Suspense fallback={<ContactPanelSkeleton />}>
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
  const admin = createSupabaseAdminClient()
  // Load the last 80 messages — that's what fits in 2-3 screens. Older
  // messages can be paged in later via a "load older" affordance. 500
  // was wasteful and made the thread payload heavy on chatty contacts.
  // Staff names (service-role read) let each outbound message show who sent
  // it — works for every staff member regardless of app_users RLS.
  const [contact, messagesRes, usersRes, replyGate] = await Promise.all([
    loadContact(contactId),
    supabase
      .from("messages")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(80),
    admin.from("app_users").select("user_id, display_name"),
    // Authoritative reply gate: drives the "implied consent expired" banner so
    // a lapsed thread blocks the composer instead of failing on send.
    assertCanSendSms(contactId, "conversational_reply"),
  ])
  if (!contact) return null
  const messages = (messagesRes.data ?? []).slice().reverse()
  const impliedExpired = !replyGate.ok && replyGate.reason === "implied_expired"
  const senderNames: Record<string, string> = {}
  for (const u of usersRes.data ?? []) {
    if (u.display_name) senderNames[u.user_id] = u.display_name
  }
  // The mobile contact sheet reuses ContactPanel, so the thread needs the same
  // panel inputs (voice + opt-in eligibility) to hand it.
  const optInMode = await loadOptInMode(contact)
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <ThreadPane
        contact={contact}
        initialMessages={messages}
        currentUserId={currentUserId}
        senderNames={senderNames}
        impliedExpired={impliedExpired}
        voiceConfigured={isVoiceConfigured()}
        optInMode={optInMode}
        optInRequestedAt={contact.marketing_opt_in_requested_at}
      />
    </div>
  )
}

async function ContactPanelLoader({ contactId }: { contactId: string }) {
  const contact = await loadContact(contactId)
  if (!contact) return null
  const optInMode = await loadOptInMode(contact)
  return (
    <ContactPanel
      contact={contact}
      voiceConfigured={isVoiceConfigured()}
      optInMode={optInMode}
      optInRequestedAt={contact.marketing_opt_in_requested_at}
    />
  )
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
