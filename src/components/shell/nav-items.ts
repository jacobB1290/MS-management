import { Inbox, Users, Megaphone, CalendarDays, Settings, FileText } from "lucide-react"

export interface NavItem {
  href: string
  label: string
  icon: typeof Inbox
  adminOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/events", label: "Events", icon: CalendarDays },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/audit", label: "Audit", icon: FileText, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
]
