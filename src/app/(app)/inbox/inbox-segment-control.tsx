"use client"
import { useState } from "react"
import { ChevronDown, Check } from "lucide-react"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  INBOX_CATEGORIES,
  CATEGORY_META,
  CATEGORY_STATUS,
  hasStatusLifecycle,
  isValidStatus,
  statusMeta,
  type InboxCategory,
} from "@/lib/inbox-segments"

interface InboxSegmentControlProps {
  contactId: string
  category: InboxCategory
  status: string | null
}

/**
 * The staff override behind the auto-classifier: a chip to move the
 * conversation between segments, and (for segments with a lifecycle) a status
 * picker. The human always wins over the classifier. State is optimistic; the
 * thread's realtime contact subscription reconciles the authoritative value.
 */
export function InboxSegmentControl({ contactId, category: catProp, status: statusProp }: InboxSegmentControlProps) {
  const [category, setCategory] = useState<InboxCategory>(catProp)
  const [status, setStatus] = useState<string | null>(statusProp)
  const [saving, setSaving] = useState(false)

  // Re-sync when the parent feeds an updated contact (realtime or thread switch).
  const [seed, setSeed] = useState(`${catProp}|${statusProp}`)
  if (seed !== `${catProp}|${statusProp}`) {
    setSeed(`${catProp}|${statusProp}`)
    setCategory(catProp)
    setStatus(statusProp)
  }

  async function patch(body: { category?: InboxCategory; status?: string | null }) {
    setSaving(true)
    try {
      const res = await fetch(`/api/contacts/${contactId}/inbox`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        toast.error("Couldn’t update the segment")
        return false
      }
      return true
    } catch (err) {
      toast.error(`Network error: ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function changeCategory(next: InboxCategory) {
    if (next === category) return
    const prevCat = category
    const prevStatus = status
    // Optimistic: drop a status the new lifecycle can't hold.
    const keepStatus = status && isValidStatus(next, status) ? status : null
    setCategory(next)
    setStatus(keepStatus)
    const ok = await patch({ category: next })
    if (!ok) {
      setCategory(prevCat)
      setStatus(prevStatus)
    }
  }

  async function changeStatus(next: string | null) {
    if (next === status) return
    const prev = status
    setStatus(next)
    const ok = await patch({ status: next })
    if (!ok) setStatus(prev)
  }

  const current = statusMeta(category, status)

  return (
    <div className="flex items-center gap-1.5">
      {/* Segment chip → move between segments */}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={saving}
          className="seg-chip inline-flex items-center gap-1 rounded-pill border border-ink-hairline px-2.5 py-1 text-label font-medium transition-colors disabled:opacity-50"
          aria-label="Change segment"
        >
          {CATEGORY_META[category].label}
          <ChevronDown size={13} className="text-ink-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          <DropdownMenuLabel>Segment</DropdownMenuLabel>
          {INBOX_CATEGORIES.map((c) => (
            <DropdownMenuItem key={c} onClick={() => void changeCategory(c)} closeOnSelect>
              <span className="flex-1">{CATEGORY_META[c].label}</span>
              {c === category && <Check size={14} className="text-gold" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Status picker → only where the segment has a lifecycle */}
      {hasStatusLifecycle(category) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={saving}
            className="seg-chip inline-flex items-center gap-1.5 rounded-pill border border-ink-hairline px-2.5 py-1 text-label font-medium transition-colors disabled:opacity-50"
            aria-label="Set status"
          >
            {current ? (
              <>
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-pill",
                    current.variant === "success"
                      ? "bg-success"
                      : current.variant === "gold"
                        ? "bg-gold"
                        : current.variant === "muted"
                          ? "bg-ink-faint"
                          : "bg-ink-muted",
                  )}
                />
                {current.label}
              </>
            ) : (
              <span className="text-ink-muted">Set status</span>
            )}
            <ChevronDown size={13} className="text-ink-faint" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            {CATEGORY_STATUS[category].map((s) => (
              <DropdownMenuItem key={s.value} onClick={() => void changeStatus(s.value)} closeOnSelect>
                <span className="flex-1">{s.label}</span>
                {s.value === status && <Check size={14} className="text-gold" />}
              </DropdownMenuItem>
            ))}
            {status && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void changeStatus(null)} closeOnSelect>
                  Clear status
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
