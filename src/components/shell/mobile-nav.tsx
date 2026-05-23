"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { NAV_ITEMS } from "./nav-items"
import { cn } from "@/lib/utils"

export function MobileNav({ role }: { role: "admin" | "member" }) {
  const pathname = usePathname()
  // Mobile bottom nav is for the three primary surfaces only — Settings and
  // Audit live in the user menu (top right) so the bottom rail doesn't get
  // crowded and the three core actions stay one-thumb reachable.
  void role
  const items = NAV_ITEMS.filter(
    (i) => i.href === "/inbox" || i.href === "/contacts" || i.href === "/campaigns",
  )

  return (
    <nav
      // Natural-flow (not fixed) so the parent flex chain reserves its space
      // — content above can't collide with it. iOS home-indicator clearance
      // via env(safe-area-inset-bottom) painted inside the nav itself.
      className="md:hidden shrink-0 border-t border-ink-hairline bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/")
          const Icon = item.icon
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2.5 px-3 min-h-[58px] text-micro transition-colors",
                  active ? "text-gold" : "text-ink-faint",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
                <span className={cn("text-[10px] tracking-wide", active && "font-semibold")}>
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
