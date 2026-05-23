"use client"
import { useSearchParams } from "next/navigation"
import { ConversationList } from "./conversation-list"
import { cn } from "@/lib/utils"
import type { Tables } from "@/lib/database.types"

type Conversation = Pick<
  Tables<"contact_summary">,
  "id" | "name" | "phone" | "email" | "tags" |
  "sms_opted_out_at" | "email_unsubscribed_at" |
  "last_message_at" | "last_message_body" | "last_message_direction" |
  "message_count"
>

interface InboxFrameProps {
  conversations: Conversation[]
  children: React.ReactNode
}

export function InboxFrame({ conversations, children }: InboxFrameProps) {
  // useSearchParams stays in sync with the URL without remounting the list.
  const sp = useSearchParams()
  const selectedId = sp.get("c") ?? undefined

  return (
    <div className="flex h-full overflow-hidden">
      <div
        className={cn(
          "shrink-0 flex-col border-r border-ink-hairline bg-surface min-h-0",
          "lg:flex lg:w-80 xl:w-96",
          selectedId ? "hidden lg:flex" : "flex w-full",
        )}
      >
        <ConversationList conversations={conversations} selectedId={selectedId} />
      </div>

      <div
        className={cn(
          "flex-1 min-w-0 min-h-0 flex flex-col",
          selectedId ? "flex" : "hidden lg:flex",
        )}
      >
        {children}
      </div>
    </div>
  )
}
