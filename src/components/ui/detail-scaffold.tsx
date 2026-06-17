import * as React from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageHeader } from "./page-header"
import { MobileCollapseHeader } from "./mobile-collapse-header"
import { PAGE_GUTTER } from "./page-scaffold"

export interface DetailScaffoldProps {
  /** Big title — the same node feeds the pinned desktop header and the mobile
   *  large title. Pass `titleText` when it isn't a plain string. */
  title: React.ReactNode
  titleText?: string
  /** Overline above the title (dynamic titles only — see PageHeader). */
  eyebrow?: React.ReactNode
  /** Quiet centered line under the title (badge · date · chips). */
  meta?: React.ReactNode
  /** Right-aligned actions — shown in the desktop header and pinned in the
   *  mobile bar so they stay reachable as the page scrolls. */
  actions?: React.ReactNode
  /** Override the mobile bar's right slot when it should differ from `actions`. */
  compactActions?: React.ReactNode
  backHref?: string
  backLabel?: string
  /** A custom back affordance (history-aware) in place of `backHref`. */
  backSlot?: React.ReactNode
  /** Hide the back affordance on desktop (the sidebar is the way out there);
   *  the mobile bar always carries it. */
  backMobileOnly?: boolean
  /** Optional full-bleed band under the desktop header (sub-nav, status strip). */
  headerBand?: React.ReactNode
  /** Extra classes for the single scroll region (e.g. `pb-0` under an EditorBar). */
  className?: string
  scrollRef?: React.Ref<HTMLDivElement>
  children: React.ReactNode
}

/**
 * Page frame for subview / detail screens. It keeps the desktop chrome exactly
 * as the PageScaffold + PageHeader pairing produced it — a compact, centered,
 * PINNED header above the one scroll region — while giving MOBILE the iOS
 * large-title treatment: the header lives inside the scroll region as a big
 * centered title that collapses into a blurred pinned bar as the page scrolls
 * (see MobileCollapseHeader). Both headers read from the same props, so the two
 * platforms can never describe a page differently.
 *
 * Desktop renders one `<header>` (display:none below md); mobile renders the
 * other (display:none from md up). Only one is ever visible, so assertions that
 * count chrome must scope to the visible header (the conformance spec does).
 */
export function DetailScaffold({
  title,
  titleText,
  eyebrow,
  meta,
  actions,
  compactActions,
  backHref,
  backLabel,
  backSlot,
  backMobileOnly,
  headerBand,
  className,
  scrollRef,
  children,
}: DetailScaffoldProps) {
  const mobileBack = backSlot ?? (
    backHref ? (
      <Link
        href={backHref}
        prefetch
        aria-label={backLabel ?? "Back"}
        title={backLabel ?? "Back"}
        className="btn-icon-circle"
      >
        <ArrowLeft size={18} />
      </Link>
    ) : null
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Desktop chrome — pinned outside the scroll region, byte-for-byte the
          PageScaffold + PageHeader output (so desktop pixels and the conformance
          gutters are unchanged). Hidden below md, where the collapse header
          takes over. */}
      <div className="hidden shrink-0 bg-bg md:block">
        <div className={cn(PAGE_GUTTER, "pt-5")}>
          <PageHeader
            eyebrow={eyebrow}
            title={title}
            meta={meta}
            actions={actions}
            backHref={backHref}
            backLabel={backLabel}
            backSlot={backSlot}
            backMobileOnly={backMobileOnly}
          />
        </div>
        {headerBand}
      </div>

      {/* The one scroll region the scaffold owns. */}
      <div
        ref={scrollRef}
        data-scroll-region
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
          PAGE_GUTTER,
          "pb-8 md:pb-10",
          className,
        )}
      >
        <MobileCollapseHeader
          className="md:hidden"
          eyebrow={eyebrow}
          title={title}
          titleText={titleText}
          meta={meta}
          back={mobileBack}
          actions={compactActions ?? actions}
        />
        {children}
      </div>
    </div>
  )
}
