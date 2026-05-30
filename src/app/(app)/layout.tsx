import { unstable_cache } from "next/cache"
import { requireStaff } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { isDemoEnabled } from "@/server/demo"
import { Sidebar } from "@/components/shell/sidebar"
import { AppShell } from "@/components/shell/app-shell"
import { ServiceWorkerRegister } from "@/components/shell/service-worker-register"
import { LiveRefresh } from "@/components/shell/live-refresh"
import { StaleReload } from "@/components/shell/stale-reload"
import { PlatformEnhancements } from "@/components/shell/platform-enhancements"
import { AppBadge } from "@/components/shell/app-badge"

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
    // Lock the whole app to the viewport. h-full (not h-dvh) tracks the fixed
    // body, which lifts its bottom edge for the keyboard inset — so the app
    // area shrinks with the keyboard instead of the composer hiding behind it.
    // Children get `flex-1 min-h-0 overflow-hidden` so internal scroll regions
    // are owned by each page rather than the outer document.
    <div className="flex h-full bg-bg overflow-hidden">
      <ServiceWorkerRegister />
      <LiveRefresh />
      <StaleReload />
      <PlatformEnhancements />
      <AppBadge count={awaitingReply} />
      <Sidebar user={user} awaitingReply={awaitingReply} />

      <AppShell
        user={user}
        role={user.role}
        demo={isDemoEnabled()}
        awaitingReply={awaitingReply}
      >
        {children}
      </AppShell>
    </div>
  )
}
