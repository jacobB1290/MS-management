"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "./button"
import { PAGE_GUTTER, PAGE_GUTTER_BLEED } from "./page-scaffold"

export interface EditorBarProps {
  /** The form this bar submits (the bar lives outside the form element so it
   *  can span the full page width under both editor columns). */
  formId: string
  submitLabel: string
  busyLabel?: string
  busy?: boolean
  /** A quiet italic status whisper on the left ("Unsaved changes", "Saves as
   *  a draft…"). Space is always reserved; presence cross-fades. */
  whisper?: React.ReactNode
  cancelLabel?: string
  onCancel?: () => void
}

/**
 * Sticky closing bar for the composition surfaces: actions stay in the thumb
 * zone on mobile and in reach on desktop while a long editor scrolls under a
 * soft cream fade. Always present from first paint — only the whisper animates.
 */
export function EditorBar({
  formId,
  submitLabel,
  busyLabel = "Saving…",
  busy = false,
  whisper,
  cancelLabel = "Cancel",
  onCancel,
}: EditorBarProps) {
  const router = useRouter()
  return (
    <div className={cn("sticky bottom-0 z-10 mt-[var(--space-2xl)]", PAGE_GUTTER_BLEED)}>
      {/* Content dissolves into the bar instead of clipping against it. */}
      <div aria-hidden className="h-6 bg-gradient-to-t from-bg to-transparent" />
      <div className={cn("border-t border-ink-hairline bg-bg/90 backdrop-blur-md", PAGE_GUTTER)}>
        <div className="flex min-h-16 items-center justify-between gap-[var(--space-md)] py-2.5">
          <p
            aria-live="polite"
            className={cn(
              // Below sm the buttons own the bar; a truncated whisper fragment
              // reads worse than none. Sentence-case sans, like every other
              // helper line — italics belong to the .motto phrase alone.
              "hidden min-w-0 truncate text-small text-ink-faint sm:block",
              "transition-opacity duration-[var(--motion-medium)] ease-[var(--ease-standard)] motion-reduce:transition-none",
              whisper ? "opacity-100" : "opacity-0",
            )}
          >
            {whisper ?? " "}
          </p>
          {/* Below sm (whisper hidden) the primary stretches into the thumb
              zone; from sm up the pair sits compactly at the right. */}
          <div className="flex w-full items-center gap-2.5 sm:w-auto sm:shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel ?? (() => router.back())}
            >
              {cancelLabel}
            </Button>
            <Button type="submit" form={formId} disabled={busy} className="flex-1 sm:flex-initial">
              {busy ? busyLabel : submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
