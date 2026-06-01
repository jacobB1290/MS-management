"use client"
import { useMemo, useState, type ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Topbar } from "./topbar"
import { MobileNav } from "./mobile-nav"
import { PRIMARY_ROUTES } from "./nav-items"
import { ChromeContext } from "./chrome-context"
import { cn } from "@/lib/utils"
import type { StaffUser } from "@/server/auth"

interface AppShellProps {
  user: StaffUser
  role: "admin" | "member"
  demo: boolean
  awaitingReply: number
  children: ReactNode
}

// The mobile chrome (top header + bottom nav) belongs only on the primary
// surfaces, which ARE the bottom-nav tabs — so both read from PRIMARY_ROUTES
// (nav-items.ts) and can never drift apart. Everything deeper — a conversation
// thread, a contact/campaign/event detail, the create forms, settings, audit —
// is a focused subview that takes over the whole screen on mobile (it carries
// its own back affordance). The inbox list and the open thread share one route,
// so the thread reports itself through ChromeContext instead of the path.

/**
 * Owns the mobile chrome and collapses it for full-screen subviews. Lives in
 * the persistent (app) layout, so navigating list -> detail doesn't remount it
 * — the header and nav animate away (and back) instead of snapping. Desktop is
 * untouched: the chrome here is `md:hidden` (desktop uses the sidebar), and the
 * safe-area padding it adds resolves to 0 off-mobile.
 */
export function AppShell({ user, role, demo, awaitingReply, children }: AppShellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Seed from the URL so a deep link into an open thread (`/inbox?c=`) paints
  // collapsed on the first frame instead of rendering the chrome and then
  // animating it shut. After mount the inbox frame keeps this in sync (incl.
  // the back-close, which the URL lags), so we only read the param once.
  const [inboxThreadOpen, setInboxThreadOpen] = useState(
    () => (pathname ?? "") === "/inbox" && searchParams.has("c"),
  )

  const onListRoot = PRIMARY_ROUTES.has(pathname ?? "")
  // A subview (mobile): hide the chrome and let the page own the full screen.
  const hidden = !onListRoot || inboxThreadOpen

  const ctx = useMemo(() => ({ setInboxThreadOpen }), [])

  return (
    <ChromeContext.Provider value={ctx}>
      <div className="flex-1 flex flex-col min-w-0">
        {/* relative z-10: lift the whole top-chrome subtree above <main> (a
            later, unpositioned sibling), so the profile dropdown — which is an
            absolutely-positioned child, not a portal — paints over the page's
            sticky search/header instead of behind it. */}
        <Collapse open={!hidden} edge="top" className="md:hidden relative z-10">
          <Topbar user={user} />
        </Collapse>

        {demo && (
          // Mirrors the chrome on mobile (it's part of the top band), but stays
          // put on desktop where the sidebar layout has no full-screen subviews.
          <Collapse open={!hidden} edge="top" desktopAlwaysOpen>
            <div className="shrink-0 bg-gold/12 border-b border-gold/25 px-4 py-1.5 text-center text-micro text-gold-dark">
              Demo mode · sample data, nothing is actually sent
            </div>
          </Collapse>
        )}

        {/*
         * Each page owns its own scroll region; main itself never scrolls.
         * When the chrome is gone the page runs edge to edge, so main carries
         * the iOS safe-area insets the header/nav used to hold (0 off-mobile).
         */}
        <main
          className="flex-1 min-h-0 overflow-hidden transition-[padding-top,padding-bottom] duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none"
          // Explicit "0px" on both ends (not undefined) so the inset animates
          // in/out cleanly on notched iOS instead of hard-jumping; resolves to 0
          // everywhere without a safe area.
          style={{
            paddingTop: hidden ? "env(safe-area-inset-top)" : "0px",
            paddingBottom: hidden ? "env(safe-area-inset-bottom)" : "0px",
          }}
        >
          {children}
        </main>

        <Collapse open={!hidden} edge="bottom" className="md:hidden">
          <MobileNav role={role} awaitingReply={awaitingReply} />
        </Collapse>
      </div>
    </ChromeContext.Provider>
  )
}

/**
 * Height-collapsing wrapper. Animates grid-template-rows 1fr <-> 0fr (no magic
 * max-height, so the speed stays even), with a small fade + slide off the
 * collapsing edge for polish. Reduced motion drops the transition but keeps the
 * end state.
 */
function Collapse({
  open,
  edge,
  className,
  desktopAlwaysOpen = false,
  children,
}: {
  open: boolean
  edge: "top" | "bottom"
  className?: string
  desktopAlwaysOpen?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "grid shrink-0 transition-[grid-template-rows] duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        desktopAlwaysOpen && "md:grid-rows-[1fr]",
        className,
      )}
      // Off-screen chrome shouldn't be read out — except the desktop-always-open
      // banner, which is collapsed only on mobile but still visible on desktop.
      aria-hidden={!open && !desktopAlwaysOpen ? true : undefined}
    >
      <div
        className={cn(
          "transition-[opacity,transform] duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
          // Clip only while collapsing/collapsed, so the height animation stays
          // clean. When open, let children overflow — otherwise the topbar's
          // dropdown menu (which hangs below the bar) gets clipped to the bar.
          open
            ? "overflow-visible opacity-100 translate-y-0"
            : cn("overflow-hidden opacity-0", edge === "top" ? "-translate-y-1" : "translate-y-1"),
          desktopAlwaysOpen && "md:overflow-visible md:opacity-100 md:translate-y-0",
        )}
      >
        {children}
      </div>
    </div>
  )
}
