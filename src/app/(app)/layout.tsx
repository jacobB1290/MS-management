import { requireStaff } from "@/server/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { isDemoEnabled } from "@/server/demo"
import { Sidebar } from "@/components/shell/sidebar"
import { MobileNav } from "@/components/shell/mobile-nav"
import { Topbar } from "@/components/shell/topbar"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireStaff()

  // Threads whose last message is inbound are awaiting a reply — surfaced as
  // a count on the Inbox nav item. Server-rendered; refreshes on navigation.
  const supabase = await createSupabaseServerClient()
  const { count } = await supabase
    .from("contact_summary")
    .select("id", { count: "exact", head: true })
    .eq("last_message_direction", "in")
  const awaitingReply = count ?? 0

  return (
    // Lock the whole app to the viewport. Children get `flex-1 min-h-0
    // overflow-hidden` so internal scroll regions are owned by each page
    // (conversation list, message thread, contact list) rather than the
    // outer document. Fixes "everything scrolls" feel.
    <div className="flex h-dvh bg-bg overflow-hidden">
      <Sidebar user={user} awaitingReply={awaitingReply} />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={user} />
        {isDemoEnabled() && (
          <div className="shrink-0 bg-gold/12 border-b border-gold/25 px-4 py-1.5 text-center text-micro text-gold-dark">
            Demo mode · sample data, nothing is actually sent
          </div>
        )}
        {/*
         * Each page owns its own scroll region (sticky header + scrolling
         * body). Main itself never scrolls; that's what kills the "everything
         * scrolls" iOS feel.
         */}
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        <MobileNav role={user.role} awaitingReply={awaitingReply} />
      </div>
    </div>
  )
}
