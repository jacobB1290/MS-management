import { Inbox, Users, Megaphone, CalendarDays, Settings, FileText } from "lucide-react"

export interface NavItem {
  href: string
  label: string
  icon: typeof Inbox
  adminOnly?: boolean
  /**
   * A primary surface: it gets a tab in the mobile bottom nav AND is treated as
   * a list root that keeps the mobile chrome (top bar + bottom nav). Settings
   * and Audit are intentionally NOT primary — they live in the user menu and
   * open as full-screen subviews on mobile.
   */
  primary?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/inbox", label: "Inbox", icon: Inbox, primary: true },
  { href: "/contacts", label: "Contacts", icon: Users, primary: true },
  { href: "/events", label: "Events", icon: CalendarDays, primary: true },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, primary: true },
  { href: "/audit", label: "Audit", icon: FileText, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
]

/**
 * The primary mobile surfaces — the bottom-nav tabs and the list-root routes —
 * in sidebar order. Single source of truth so the bottom nav (mobile-nav.tsx)
 * and the chrome-visibility logic (app-shell.tsx) can never disagree about what
 * counts as a tab. Add a tab by flipping `primary: true` above; everything else
 * (the rail, which routes keep the chrome, the bottom-nav column count) follows.
 */
export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((i) => i.primary)
export const PRIMARY_ROUTES: ReadonlySet<string> = new Set(
  PRIMARY_NAV_ITEMS.map((i) => i.href),
)
