import Link from "next/link"
import { headers } from "next/headers"
import { NAV_ITEMS } from "./nav-items"
import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { StaffUser } from "@/server/auth"

export async function Sidebar({ user }: { user: StaffUser }) {
  // Use the x-invoke-path header for active route detection in RSC; fall back
  // to the URL pathname if Next exposes it differently across versions.
  const hdrs = await headers()
  const path = hdrs.get("x-invoke-path") || hdrs.get("x-pathname") || ""

  const items = NAV_ITEMS.filter(
    (item) => !item.adminOnly || user.role === "admin",
  )

  return (
    <aside className="hidden md:flex md:w-64 lg:w-72 shrink-0 flex-col border-r border-ink-hairline bg-surface">
      <div className="px-6 pt-7 pb-5">
        <p className="eyebrow">Morning Star</p>
        <p className="font-display text-heading text-ink leading-tight mt-1">
          Management
        </p>
      </div>

      <nav className="flex-1 px-3 pb-4">
        <ul className="space-y-1">
          {items.map((item) => {
            const active = path === item.href || path.startsWith(item.href + "/")
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-md px-3 py-2.5 text-body transition-colors",
                    active
                      ? "bg-white text-ink shadow-[var(--shadow-xs)]"
                      : "text-ink-muted hover:bg-white/60 hover:text-ink",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon
                    size={18}
                    className={cn(
                      "shrink-0 transition-colors",
                      active ? "text-gold" : "text-ink-faint group-hover:text-ink-muted",
                    )}
                  />
                  <span className={active ? "font-medium" : ""}>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="px-3 pb-4 pt-3 border-t border-ink-hairline">
        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-white/60 transition-colors"
        >
          <Avatar name={user.displayName ?? user.email} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-small font-medium text-ink truncate">
              {user.displayName ?? user.email}
            </p>
            <p className="text-micro text-ink-faint capitalize">{user.role}</p>
          </div>
        </Link>
      </div>
    </aside>
  )
}
