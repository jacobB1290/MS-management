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
         * `overflow-y-auto` so pages that don't manage their own scrolling
         * (contacts, campaigns, settings, audit) work out of the box; the
         * inbox sets its own `overflow-hidden` wrapper, so main never has to
         * scroll there. `overscroll-contain` keeps rubber-band scrolling out
         * of the document.
         */}
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</main>
        <MobileNav role={user.role} />
      </div>
    </div>
  )
}
