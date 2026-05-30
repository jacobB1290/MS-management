"use client"
import { createContext } from "react"

/**
 * Lets a deep child (the inbox frame) tell the app shell that a mobile
 * full-screen subview is open, so the shell can collapse the top header and
 * bottom nav away. The inbox thread lives at the same route as the list
 * (`/inbox?c=`), so route alone can't tell them apart — the frame reports its
 * own open/closing state here and the collapse stays in lockstep with the
 * pane slide (same state, same 300ms).
 */
export const ChromeContext = createContext<{
  setInboxThreadOpen: (open: boolean) => void
} | null>(null)
