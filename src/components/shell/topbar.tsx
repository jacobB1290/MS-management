"use client"
import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { ChevronDown, LogOut, Settings, FileText } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { StaffUser } from "@/server/auth"

interface TopbarProps {
  user: StaffUser
  title?: string
}

const SECTION_TITLES: Record<string, string> = {
  inbox: "Inbox",
  contacts: "Contacts",
  events: "Events",
  campaigns: "Campaigns",
  settings: "Settings",
  audit: "Audit log",
}

export function Topbar({ user, title }: TopbarProps) {
  const [open, setOpen] = useState(false)
  // iOS large-title: the section title rides large at rest and shrinks to the
  // compact size once the page scrolls (the overline folds away, a hairline
  // resolves under the bar). State only — the motion is the CSS transitions on
  // .topbar-title / .topbar-eyebrow keyed off [data-scrolled].
  const [scrolled, setScrolled] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const section = pathname?.split("/")[1] ?? ""
  const derivedTitle = title ?? SECTION_TITLES[section] ?? "Management"

  // Shrink the large title as the active page's scroll region scrolls. A single
  // capturing listener on the document reads the scrollTop off whatever
  // [data-scroll-region] fired — scroll doesn't bubble, but a capture-phase
  // listener still sees it. This is deliberately NOT bound to a specific element:
  // the Topbar persists across the tabs while each page's region remounts under
  // it (the inbox rail even remounts on a filter switch), and an element binding
  // would go stale. rAF-throttled; non-region scrolls early-return.
  useEffect(() => {
    let raf = 0
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement | null
      if (!t?.matches?.("[data-scroll-region]")) return
      const top = t.scrollTop
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setScrolled(top > 4))
    }
    document.addEventListener("scroll", onScroll, { capture: true, passive: true })
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener("scroll", onScroll, true)
    }
  }, [])

  // Reset to the current region's position on route change — a restored
  // mid-scroll page paints compact, and a page with no region (or scrolled to
  // top) shows the large title. One frame's wait lets the new region mount.
  useEffect(() => {
    const r = requestAnimationFrame(() => {
      const region = document.querySelector<HTMLElement>("[data-scroll-region]")
      setScrolled((region?.scrollTop ?? 0) > 4)
    })
    return () => cancelAnimationFrame(r)
  }, [pathname])

  async function handleSignOut() {
    await fetch("/logout", { method: "POST" })
    router.replace("/login")
  }

  return (
    // shrink-0 keeps the topbar at its natural (content-driven) height inside the
    // parent flex chain, so it follows the title shrink + eyebrow fold smoothly.
    // paddingTop is additive (calc, not max) so the status bar always has its own
    // clear safe-area band under standalone PWA mode. The border resolves from
    // transparent to a hairline on scroll — iOS large-title chrome is borderless
    // at the top and gains its edge only once content sits beneath it.
    <header
      data-scrolled={scrolled ? "true" : "false"}
      className={cn(
        "md:hidden shrink-0 flex items-center justify-between gap-3 border-b bg-bg px-4 py-3",
        "transition-colors duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
        scrolled ? "border-ink-hairline" : "border-transparent",
      )}
      style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
    >
      <div className="min-w-0">
        <div className="topbar-eyebrow">
          <p className="eyebrow">Morning Star</p>
        </div>
        <p className="topbar-title font-display text-ink leading-none mt-0.5 truncate">
          {derivedTitle}
        </p>
      </div>

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger className="flex shrink-0 items-center gap-2 self-start rounded-pill px-2 py-1.5 active:bg-white/60 transition-colors min-h-11">
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
