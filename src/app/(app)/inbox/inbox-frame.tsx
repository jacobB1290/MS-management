"use client"
import { createContext, useCallback, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ConversationList } from "./conversation-list"
import { cn } from "@/lib/utils"
import type { Tables } from "@/lib/database.types"

type Conversation = Pick<
  Tables<"contact_summary">,
  "id" | "name" | "phone" | "email" | "tags" |
  "sms_opted_out_at" | "email_unsubscribed_at" | "is_member" |
  "inbox_category" | "inbox_status" |
  "last_message_at" | "last_message_body" | "last_message_direction" |
  "last_message_channel" | "message_count"
>

interface InboxFrameProps {
  conversations: Conversation[]
  children: React.ReactNode
}

/**
 * Lets the thread (rendered as server `children`, so it can't reach this
 * component's state directly) trigger the mobile slide-out before the route
 * actually changes. The back button animates the panel away with its content
 * still mounted, then we drop `?c=` — otherwise the content would snap to the
 * empty state the instant you tapped back.
 */
export const InboxNavContext = createContext<{ closeThread: () => void } | null>(null)

const SLIDE_MS = 300

export function InboxFrame({ conversations, children }: InboxFrameProps) {
  // useSearchParams stays in sync with the URL without remounting the list.
  const sp = useSearchParams()
  const router = useRouter()
  const selectedId = sp.get("c") ?? undefined
  const [closing, setClosing] = useState(false)

  const closeThread = useCallback(() => {
    setClosing(true)
    // Let the slide-out play, then clear the route. We deliberately DON'T reset
    // `closing` here: the URL (selectedId) update lags this tick, so flipping it
    // back now makes threadOpen briefly true again — the panel slides back in,
    // then out ("goes back in then back out"). It's reset in render below, once
    // the route has actually cleared.
    window.setTimeout(() => {
      router.push("/inbox", { scroll: false })
    }, SLIDE_MS)
  }, [router])

  // Once the route has actually cleared, the close is done. Reconcile during
  // render (not in an effect) — same pattern as the conversation list's
  // selectedId sync — so there's no extra commit or flicker, and no
  // setState-in-effect. It can't loop: it only fires while closing && no route,
  // and immediately makes that condition false.
  if (closing && !selectedId) setClosing(false)

  // Drives the mobile slide. Desktop ignores it (both panes are docked there).
  const threadOpen = Boolean(selectedId) && !closing

  return (
    <InboxNavContext.Provider value={{ closeThread }}>
      <div className="h-full overflow-hidden">
        {/* Two-pane track. On mobile it's twice the viewport wide (list screen +
            thread screen) and slides one screen left to reveal the thread, then
            back to reveal the list — iMessage-style, with both panes mounted so
            the slide is seamless in both directions. On desktop the track
            collapses to the normal list-rail + thread layout with no transform. */}
        <div
          className={cn(
            "flex h-full min-h-0",
            "transition-transform duration-300 ease-[var(--ease-out-soft)] lg:transition-none",
            // The track's own width is one viewport; -translate-x-full shifts it
            // a full screen so the second pane (thread) fills the viewport.
            threadOpen ? "max-lg:-translate-x-full" : "translate-x-0",
          )}
        >
          {/* Conversation list: a full inbox-pane on mobile, a fixed rail on
              desktop. w-full (not w-screen) so it fits the inbox area even when
              the app sidebar is showing at tablet widths. */}
          <div className="flex min-h-0 w-full shrink-0 flex-col border-r border-ink-hairline bg-surface lg:w-80 xl:w-96">
            <ConversationList conversations={conversations} selectedId={selectedId} />
          </div>

          {/* Thread pane: a full inbox-pane on mobile, the flexible remainder on desktop. */}
          <div className="flex min-h-0 flex-col bg-bg max-lg:w-full max-lg:shrink-0 lg:flex-1">
            {children}
          </div>
        </div>
      </div>
    </InboxNavContext.Provider>
  )
}
