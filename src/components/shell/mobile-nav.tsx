"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { NAV_ITEMS } from "./nav-items"
import { cn } from "@/lib/utils"

export function MobileNav({ role }: { role: "admin" | "member" }) {
  const pathname = usePathname()
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || role === "admin").slice(0, 4)

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-ink-hairline bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <ul className="grid grid-cols-4">
        {items.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/")
          const Icon = item.icon
          return (
            <li key={item.href}>
              <Link
                href={item.href}
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
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  )
}
