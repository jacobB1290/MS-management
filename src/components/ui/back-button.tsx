"use client"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"

/**
 * History-aware back affordance for subviews reached from the global user menu
 * (settings, audit) — there's no single parent route to point a Link at, and on
 * mobile the chrome that menu lives in is hidden, so this is the way back. Falls
 * back to the inbox if there's no history to pop (deep link / refresh). Same
 * circular chrome as the PageHeader back link.
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
      title={label}
      className="btn-icon-circle"
    >
      <ArrowLeft size={18} />
    </button>
  )
}
