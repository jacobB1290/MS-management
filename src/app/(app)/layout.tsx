import { unstable_cache } from "next/cache"
import { requireStaff } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { isDemoEnabled } from "@/server/demo"
import { Sidebar } from "@/components/shell/sidebar"
import { MobileNav } from "@/components/shell/mobile-nav"
import { Topbar } from "@/components/shell/topbar"
import { ServiceWorkerRegister } from "@/components/shell/service-worker-register"
import { LiveRefresh } from "@/components/shell/live-refresh"

// Threads whose last message is inbound and that we can still reply to are
// awaiting a reply — surfaced as a count on the Inbox nav item. The query runs
// the contact_summary lateral join over every contact, so without a cache it
// re-ran on EVERY page navigation across the whole app. The count is the same
// for all staff, so cache it briefly (admin client, no per-user cookie) and
// let it go a few seconds stale rather than paying for it on every render.
const getAwaitingReplyCount = unstable_cache(
  async () => {
    const admin = createSupabaseAdminClient()
    const { count } = await admin
      .from("contact_summary")
      .select("id", { count: "exact", head: true })
      .eq("last_message_direction", "in")
      .is("sms_opted_out_at", null)
    return count ?? 0
  },
  ["awaiting-reply-count"],
  { revalidate: 15, tags: ["awaiting-reply"] },
)

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Independent: the awaiting-reply count doesn't depend on the user, so run
  // both together instead of paying two serial round-trips on every nav.
  const [user, awaitingReply] = await Promise.all([
    requireStaff(),
    getAwaitingReplyCount(),
  ])

  return (
    // Lock the whole app to the viewport. Children get `flex-1 min-h-0
    // overflow-hidden` so internal scroll regions are owned by each page
    // (conversation list, message thread, contact list) rather than the
    // outer document. Fixes "everything scrolls" feel.
    <div className="flex h-dvh bg-bg overflow-hidden">
      <ServiceWorkerRegister />
      <LiveRefresh />
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
