"use client"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * History-aware back affordance for subviews reached from the global user menu
 * (settings, audit) — there's no single parent route to point a Link at, and on
 * mobile the chrome that menu lives in is hidden, so this is the way back. Falls
 * back to the inbox if there's no history to pop (deep link / refresh). Matches
 * the PageHeader back link's sizing: a 44px icon target on mobile, a labelled
 * inline link on desktop.
 */
export function BackButton({ label = "Back" }: { label?: string }) {
  const router = useRouter()

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back()
    } else {
      router.push("/inbox")
    }
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1.5 shrink-0 text-small text-ink-muted hover:text-ink active:text-ink transition-colors",
        "justify-center h-11 w-11 -ml-2 rounded-pill hover:bg-white",
        "sm:h-auto sm:min-h-11 sm:w-auto sm:ml-0 sm:justify-start sm:rounded-none sm:hover:bg-transparent",
      )}
    >
      <ArrowLeft size={18} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
