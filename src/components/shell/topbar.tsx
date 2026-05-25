"use client"
import { useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  ChevronDown,
  LogOut,
  Settings,
  FileText,
  HeartHandshake,
  MessageCircleQuestion,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Avatar } from "@/components/ui/avatar"
import type { StaffUser } from "@/server/auth"

interface TopbarProps {
  user: StaffUser
  title?: string
}

const SECTION_TITLES: Record<string, string> = {
  inbox: "Inbox",
  contacts: "Contacts",
  campaigns: "Campaigns",
  prayer: "Prayer",
  inquiries: "Inquiries",
  settings: "Settings",
  audit: "Audit log",
}

export function Topbar({ user, title }: TopbarProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const section = pathname?.split("/")[1] ?? ""
  const derivedTitle = title ?? SECTION_TITLES[section] ?? "Management"

  async function handleSignOut() {
    await fetch("/logout", { method: "POST" })
    router.replace("/login")
  }

  return (
    // shrink-0 keeps the topbar at its natural height inside the parent
    // flex chain. paddingTop is additive (calc, not max) so the status
    // bar always has its own clear safe-area band — under standalone
    // PWA mode with viewport-fit: cover, this prevents the J avatar +
    // iOS status icons from landing in the same z-space.
    <header
      className="md:hidden shrink-0 flex items-center justify-between border-b border-ink-hairline bg-bg px-4 py-3"
      style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
    >
      <div>
        <p className="eyebrow">Morning Star</p>
        <p className="font-display text-lead text-ink leading-none mt-0.5">
          {derivedTitle}
        </p>
      </div>

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-pill px-2 py-1.5 active:bg-white/60 transition-colors min-h-11">
          <Avatar name={user.displayName ?? user.email} size="sm" />
          <ChevronDown size={14} className="text-ink-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <div className="px-3 py-2">
            <p className="text-small font-medium text-ink truncate">
              {user.displayName ?? user.email}
            </p>
            <p className="text-micro text-ink-faint capitalize">{user.role}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/prayer")} closeOnSelect>
            <HeartHandshake size={14} />
            <span>Prayer</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/inquiries")} closeOnSelect>
            <MessageCircleQuestion size={14} />
            <span>Inquiries</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => router.push("/settings")}
            closeOnSelect
          >
            <Settings size={14} />
            <span>Settings</span>
          </DropdownMenuItem>
          {user.role === "admin" && (
            <DropdownMenuItem
              onClick={() => router.push("/audit")}
              closeOnSelect
            >
              <FileText size={14} />
              <span>Audit log</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut}>
            <LogOut size={14} />
            <span>Sign out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
