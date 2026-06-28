"use client"

import * as React from "react"
import {
  ChevronLeft,
  ChevronRight,
  User,
  Bell,
  Sparkles,
  BookOpen,
  Receipt,
  HardDrive,
  Users,
  Server,
  Clapperboard,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Settings, the way macOS System Settings / iOS Settings do it: a category rail
 * on the left and the selected pane on the right. The page used to be one long
 * column of cards with big empty gaps; here each category is its own focused
 * pane reached from the rail.
 *
 * Two designs, one system (per the platform-UX rule): desktop is the docked
 * rail + pane side by side; mobile is a single-focus drill-in — the rail becomes
 * a grouped iOS list, tapping a row pushes its pane in, and a back affordance
 * pops it away. Every move animates (the rail selection cross-fades, the pane
 * fades up on desktop and pushes/pops on mobile — see the keyframes in
 * globals.css), and reduced-motion neutralizes all of it.
 *
 * The server renders each pane's content (with its own Suspense/streaming) and
 * hands it in as `sections`; this component owns only the navigation chrome and
 * the motion, never the data. The visible label/blurb/icon for each id live in
 * META below so the server payload stays just `{ id, content }`.
 */

export type SettingsSectionId =
  | "account"
  | "notifications"
  | "ai-models"
  | "services"
  | "knowledge"
  | "usage"
  | "storage"
  | "team"
  | "system"

export interface SettingsSection {
  id: SettingsSectionId
  content: React.ReactNode
}

type SectionMeta = { label: string; blurb: string; icon: LucideIcon }

const META: Record<SettingsSectionId, SectionMeta> = {
  account: {
    label: "Account",
    blurb: "Your profile and access level in the console.",
    icon: User,
  },
  notifications: {
    label: "Notifications",
    blurb: "Push alerts on this device when a new message arrives.",
    icon: Bell,
  },
  "ai-models": {
    label: "AI models",
    blurb:
      "Pick the Claude model and reasoning effort behind each assistant. Changes take effect immediately, no redeploy.",
    icon: Sparkles,
  },
  services: {
    label: "Services",
    blurb:
      "How segmented services reach ms.church — auto-publish completed runs, or hold them for review first.",
    icon: Clapperboard,
  },
  knowledge: {
    label: "Church knowledge",
    blurb:
      "Facts the draft assistant can cite when replying — service times, studies, ministries, how to visit.",
    icon: BookOpen,
  },
  usage: {
    label: "Usage",
    blurb: "Live messaging and AI spend, straight from the providers.",
    icon: Receipt,
  },
  storage: {
    label: "Storage",
    blurb: "Database and media usage against the free-tier limits.",
    icon: HardDrive,
  },
  team: {
    label: "Team",
    blurb: "Who can sign in, and what they’re allowed to do.",
    icon: Users,
  },
  system: {
    label: "System",
    blurb: "Provider configuration and the keep-warm heartbeat.",
    icon: Server,
  },
}

export function SettingsShell({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = React.useState<SettingsSectionId>(sections[0].id)
  // Mobile-only: have we drilled into a pane? Desktop shows rail + pane together
  // and ignores this entirely. (A URL fragment is never sent to the server, so
  // there's no clean SSR deep-link without a hydration mismatch — the rail just
  // opens on the first pane, the way System Settings opens on its top item.)
  const [detailOpen, setDetailOpen] = React.useState(false)
  // Has the operator selected a category at least once? Entrance animations are
  // gated on this so the landing content (the pane on desktop, the list on
  // mobile) is simply *present* on first paint — it never slides/fades in as if
  // it were arriving, which would read as gratuitous.
  const [navigated, setNavigated] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)

  const open = React.useCallback((id: SettingsSectionId) => {
    setActive(id)
    setDetailOpen(true)
    setNavigated(true)
  }, [])

  const back = React.useCallback(() => setDetailOpen(false), [])

  // Switching panes can swap a tall pane for a short one (or vice versa); since
  // each pane is keyed/remounted, a retained scroll offset would land the reader
  // mid-pane. Reset the one scroll region to the top of the freshly-selected
  // pane — the expected System-Settings behaviour. The new pane enters at
  // opacity 0 (backwards fill), so this reset is never visible as a jump.
  React.useEffect(() => {
    rootRef.current
      ?.closest<HTMLElement>("[data-scroll-region]")
      ?.scrollTo({ top: 0 })
  }, [active])

  const activeSection = sections.find((s) => s.id === active) ?? sections[0]
  const activeMeta = META[activeSection.id]

  return (
    <div
      ref={rootRef}
      className="pt-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-[var(--space-2xl)]"
    >
      {/* ── Rail (desktop) / grouped list (mobile) ─────────────────────────── */}
      <nav
        aria-label="Settings categories"
        className={cn(
          "lg:sticky lg:top-2 lg:self-start",
          // Mobile: when you tap back, the list re-appears (display:none→block,
          // which re-fires the CSS animation) with a gentle fade+rise — but only
          // after a first drill-in (`navigated`), never on initial paint.
          // Desktop: docked, no entrance.
          navigated &&
            !detailOpen &&
            "max-lg:animate-[settings-pane-in_var(--motion-medium)_var(--ease-out-soft)_backwards]",
          detailOpen && "max-lg:hidden",
        )}
      >
        <ul
          className={cn(
            // Mobile: one grouped iOS card with hairline dividers.
            "overflow-hidden rounded-xl border border-ink-hairline bg-white divide-y divide-ink-hairline",
            // Desktop: free-floating pills, no card.
            "lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:divide-y-0 lg:space-y-1",
          )}
        >
          {sections.map(({ id }) => {
            const meta = META[id]
            const Icon = meta.icon
            const selected = id === active
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => open(id)}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "group flex w-full items-center gap-3 text-left",
                    // Include box-shadow so the selected pill's soft shadow fades
                    // in with its background rather than hard-cutting beside it.
                    "transition-[color,background-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/35",
                    // Mobile metrics: tall touch rows inside the grouped card.
                    "px-4 py-3 text-ink active:bg-surface",
                    // Desktop: mirror the app sidebar's nav rows exactly (white
                    // pill + soft shadow when active, muted + hover:white/60
                    // otherwise) so this reads as a sub-nav in the same design
                    // language, not a separate widget bolted on.
                    "lg:rounded-md lg:px-3 lg:py-2.5 lg:active:bg-transparent",
                    selected
                      ? "lg:bg-white lg:text-ink lg:shadow-[var(--shadow-xs)]"
                      : "lg:text-ink-muted lg:hover:bg-white/60 lg:hover:text-ink",
                  )}
                >
                  <Icon
                    size={18}
                    className={cn(
                      "shrink-0 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
                      // Gold accent on mobile (and when active on desktop); faint
                      // on inactive desktop rows — identical to the sidebar icons.
                      "text-gold",
                      !selected && "lg:text-ink-faint lg:group-hover:text-ink-muted",
                    )}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-body font-medium",
                      !selected && "lg:font-normal",
                    )}
                  >
                    {meta.label}
                  </span>
                  <ChevronRight
                    size={18}
                    className="shrink-0 text-ink-faint lg:hidden"
                    aria-hidden
                  />
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* ── Active pane ────────────────────────────────────────────────────── */}
      <div className={cn("min-w-0", !detailOpen && "max-lg:hidden")}>
        <button
          type="button"
          onClick={back}
          className={cn(
            "lg:hidden inline-flex items-center gap-1 -ml-1.5 mb-3 h-9 pr-2",
            // Match the app's other back affordances (muted ink → ink), not an
            // iOS accent-coloured back, so it belongs to the same family.
            "text-small font-medium text-ink-muted",
            "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:text-ink active:text-ink",
          )}
        >
          <ChevronLeft size={18} aria-hidden />
          Settings
        </button>

        {/* Keyed by the active id so the fade replays on every switch (desktop)
            and every drill-in (mobile). Gated on `navigated` so the first pane
            is present on load, not animated in. An honest fade+rise (same on
            both breakpoints) rather than a one-sided horizontal "push". */}
        <section
          key={activeSection.id}
          className={cn(
            navigated &&
              "animate-[settings-pane-in_var(--motion-medium)_var(--ease-out-soft)_backwards]",
          )}
        >
          <header className="mb-[var(--space-lg)]">
            {/* One tier below the page title ("Settings", --text-heading) so
                the pane heading reads as a section, not a second page title. */}
            <h2 className="font-display text-lead font-semibold leading-[var(--leading-snug)] tracking-[var(--tracking-tight)] text-ink">
              {activeMeta.label}
            </h2>
            <p className="mt-1.5 max-w-[62ch] text-small leading-[var(--leading-prose)] text-ink-muted">
              {activeMeta.blurb}
            </p>
          </header>
          <div className="space-y-[var(--space-lg)]">{activeSection.content}</div>
        </section>
      </div>
    </div>
  )
}
