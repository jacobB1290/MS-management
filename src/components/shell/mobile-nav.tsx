"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { PRIMARY_NAV_ITEMS } from "./nav-items"
import { cn } from "@/lib/utils"

export function MobileNav({
  role,
  awaitingReply = 0,
}: {
  role: "admin" | "member"
  awaitingReply?: number
}) {
  const pathname = usePathname()
  // The bottom nav is the primary surfaces, straight from the single source of
  // truth (Settings + Audit live in the user menu, so the rail stays uncrowded
  // and one-thumb reachable). Same list the app-shell uses to decide when the
  // mobile chrome shows, so a tab and its chrome can never disagree.
  void role
  const items = PRIMARY_NAV_ITEMS

  return (
    <nav
      // Natural-flow (not fixed) so the parent flex chain reserves its space
      // — content above can't collide with it. iOS home-indicator clearance
      // via env(safe-area-inset-bottom) painted inside the nav itself.
      className="md:hidden shrink-0 border-t border-ink-hairline bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul
        className="grid"
        // Columns track the number of primary tabs, so adding/removing one in
        // nav-items.ts never leaves a stale hard-coded count.
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/")
          const Icon = item.icon
          const badge = item.href === "/inbox" && awaitingReply > 0 ? awaitingReply : 0
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch
                className={cn(
                  // Tighter side padding than the old 3-up rail so four labels
                  // (incl. "Campaigns") sit comfortably at the 360px width.
                  "flex flex-col items-center justify-center gap-1 py-2.5 px-1 min-h-[58px] text-micro transition-colors active:bg-white/50",
                  active ? "text-gold" : "text-ink-faint",
                )}
                aria-current={active ? "page" : undefined}
              >
                <span className="relative">
                  <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
                  {badge > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-pill bg-gold text-white text-[10px] font-semibold leading-none"
                      aria-label={`${badge} awaiting reply`}
                    >
                      {/* Same cap as the desktop sidebar badge — the two
                          surfaces showed different numbers for one count. */}
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "text-eyebrow tracking-wide whitespace-nowrap",
                    active && "font-semibold",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
