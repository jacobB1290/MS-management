import * as React from "react"
import { PageHeader } from "./page-header"
import { PageScaffold } from "./page-scaffold"
import { MobileCollapsingHeader } from "./collapsing-header"

export interface DetailScaffoldProps {
  /** Page title — a string on real pages; a <Skeleton/> in loading frames. */
  title: React.ReactNode
  /** Tiny overline above the title. Only for dynamic titles ("Event",
   *  "Campaign" over user-entered text); static self-describing titles skip it. */
  eyebrow?: React.ReactNode
  actions?: React.ReactNode
  meta?: React.ReactNode
  /** Context popover (ⓘ) shown beside the title. */
  info?: React.ReactNode
  backHref?: string
  backLabel?: string
  backSlot?: React.ReactNode
  /** Hide the back affordance on md+ (Settings/Audit have the sidebar). The
   *  mobile collapsing bar always keeps it — it's the only way out on a phone. */
  backMobileOnly?: boolean
  children: React.ReactNode
  /** Forwarded to the scroll region (e.g. "pb-0 md:pb-0" under a sticky bar). */
  className?: string
  headerBand?: React.ReactNode
  scrollRef?: React.Ref<HTMLDivElement>
}

/**
 * THE frame for every detail / subview page — one component so they all collapse
 * identically and the two layouts can never drift. Pass the header parts ONCE:
 * it renders the static centered {@link PageHeader} for md+ (in the scaffold's
 * pinned band) and the iOS {@link MobileCollapsingHeader} for phones/tablets (at
 * the top of the one scroll region), both wired from the same props.
 *
 * List pages (Contacts / Events / Campaigns) keep PageScaffold + PageMasthead;
 * the Inbox owns its own chrome. Everything reached as a subview — detail pages,
 * the create/edit forms, Settings, Audit — goes through here.
 */
export function DetailScaffold({
  title,
  eyebrow,
  actions,
  meta,
  info,
  backHref,
  backLabel,
  backSlot,
  backMobileOnly,
  children,
  className,
  headerBand,
  scrollRef,
}: DetailScaffoldProps) {
  return (
    <PageScaffold
      scrollRef={scrollRef}
      headerBand={headerBand}
      className={className}
      header={
        <PageHeader
          title={title}
          eyebrow={eyebrow}
          actions={actions}
          meta={meta}
          info={info}
          backHref={backHref}
          backLabel={backLabel}
          backSlot={backSlot}
          backMobileOnly={backMobileOnly}
        />
      }
      collapseHeader={
        <MobileCollapsingHeader
          title={title}
          eyebrow={eyebrow}
          actions={actions}
          meta={meta}
          info={info}
          backHref={backHref}
          backLabel={backLabel}
          backSlot={backSlot}
        />
      }
    >
      {children}
    </PageScaffold>
  )
}
