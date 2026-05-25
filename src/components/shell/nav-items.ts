import { Inbox, Users, Megaphone, Settings, FileText, HeartHandshake } from "lucide-react"

export interface NavItem {
  href: string
  label: string
  icon: typeof Inbox
  adminOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/prayer", label: "Prayer", icon: HeartHandshake },
  { href: "/audit", label: "Audit", icon: FileText, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
]
