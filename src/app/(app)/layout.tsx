import { requireStaff } from "@/server/auth"
import { Sidebar } from "@/components/shell/sidebar"
import { MobileNav } from "@/components/shell/mobile-nav"
import { Topbar } from "@/components/shell/topbar"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireStaff()

  return (
    // Lock the whole app to the viewport. Children get `flex-1 min-h-0
    // overflow-hidden` so internal scroll regions are owned by each page
    // (conversation list, message thread, contact list) rather than the
    // outer document. Fixes "everything scrolls" feel.
    <div className="flex h-dvh bg-bg overflow-hidden">
      <Sidebar user={user} />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={user} />
        {/*
         * Each page owns its own scroll region (sticky header + scrolling
         * body). Main itself never scrolls; that's what kills the "everything
         * scrolls" iOS feel.
         */}
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        <MobileNav role={user.role} />
      </div>
    </div>
  )
}
