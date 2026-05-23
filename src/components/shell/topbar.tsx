"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, LogOut } from "lucide-react"
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

export function Topbar({ user, title }: TopbarProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  async function handleSignOut() {
    await fetch("/logout", { method: "POST" })
    router.replace("/login")
  }

  return (
    // shrink-0 keeps the topbar at its natural height inside the parent
    // flex chain so it doesn't compete with `main` for space (was sticky
    // before, which counted on document scroll — we don't have that now).
    <header
      className="md:hidden shrink-0 flex items-center justify-between border-b border-ink-hairline bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80 px-4 py-3"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      <div>
        <p className="eyebrow">Morning Star</p>
        <p className="font-display text-lead text-ink leading-none mt-0.5">
          {title ?? "Management"}
        </p>
      </div>

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-pill px-2 py-1.5 hover:bg-white/60 transition-colors">
          <Avatar name={user.displayName ?? user.email} size="sm" />
          <ChevronDown size={14} className="text-ink-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <div className="px-3 py-2">
            <p className="text-small font-medium text-ink truncate">
              {user.displayName ?? user.email}
            </p>
            <p className="text-micro text-ink-faint capitalize">{user.role}</p>
          </div>
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
