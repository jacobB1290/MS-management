"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkles, Check, Plus, X, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface Suggestion {
  existing_tags: string[]
  proposed_tag: string | null
  rationale: string
}

/**
 * "Suggest tags" affordance. Asks Claude (Haiku) to pick tags from the thread,
 * shows them as toggleable chips, and only writes the operator-confirmed set to
 * `contacts.tags` via the audited PATCH endpoint. Hidden entirely when the AI
 * integration is not configured. Used on the contact page and the inbox panel.
 */
export function SuggestTags({
  contactId,
  currentTags,
}: {
  contactId: string
  currentTags: string[]
}) {
  const router = useRouter()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  // Tags the operator has ticked to apply (subset of suggestion candidates).
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    fetch("/api/ai/status")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((j) => {
        if (active) setEnabled(Boolean(j.enabled))
      })
      .catch(() => {
        if (active) setEnabled(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Don't render anything until we know, and nothing if AI is off.
  if (enabled !== true) return null

  const candidates = suggestion
    ? [...suggestion.existing_tags, ...(suggestion.proposed_tag ? [suggestion.proposed_tag] : [])]
    : []

  async function runSuggest() {
    setLoading(true)
    setSuggestion(null)
    setSelected(new Set())
    try {
      const res = await fetch("/api/ai/suggest-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(
          json?.error === "no_context"
            ? "No messages yet to suggest tags from"
            : json?.error === "disabled"
              ? "Tag suggestions aren’t configured"
              : "Couldn’t generate suggestions",
        )
        return
      }
      const next = json.suggestion as Suggestion
      setSuggestion(next)
      // Pre-select every candidate; the operator unticks what they don't want.
      setSelected(
        new Set([
          ...next.existing_tags,
          ...(next.proposed_tag ? [next.proposed_tag] : []),
        ]),
      )
      if (next.existing_tags.length === 0 && !next.proposed_tag) {
        toast.message("No new tags suggested for this contact")
      }
    } catch (err) {
      toast.error(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  function toggle(tag: string) {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  async function apply() {
    const additions = candidates.filter((t) => selected.has(t))
    if (additions.length === 0) {
      setSuggestion(null)
      return
    }
    // Merge with existing tags (deduped) — the write is the operator's intent.
    const merged = Array.from(new Set([...currentTags, ...additions]))
    setSaving(true)
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: merged }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Save failed: ${j?.error ?? res.status}`)
        return
      }
      toast.success(additions.length === 1 ? "Tag added" : `${additions.length} tags added`)
      setSuggestion(null)
      setSelected(new Set())
      router.refresh()
    } catch (err) {
      toast.error(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={runSuggest} disabled={loading}>
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {loading ? "Thinking…" : "Suggest tags"}
      </Button>

      {/* Suggestions float as a popover so the trigger can sit inline in a row. */}
      {suggestion && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-[min(340px,80vw)] rounded-md border border-ink-hairline bg-surface p-4 text-left shadow-[var(--shadow-md)]">
          <div className="flex items-start justify-between gap-3">
            <p className="text-small text-ink-muted leading-prose">
              <Sparkles size={13} className="inline-block mr-1 -mt-0.5 text-gold" />
              {suggestion.rationale}
            </p>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              aria-label="Dismiss suggestions"
              className="shrink-0 text-ink-muted hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>

          {candidates.length > 0 ? (
            <>
              <p className="text-label text-ink-muted mt-3 mb-2">
                Tap to choose, then confirm
              </p>
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((tag) => {
                  const isSelected = selected.has(tag)
                  const isNew = suggestion.proposed_tag === tag
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggle(tag)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-[var(--tracking-wide)] transition-colors",
                        isSelected
                          ? "bg-gold text-white"
                          : "bg-transparent text-ink-muted ring-1 ring-ink-hairline hover:text-ink",
                      )}
                      aria-pressed={isSelected}
                    >
                      {isSelected ? <Check size={11} /> : <Plus size={11} />}
                      {tag}
                      {isNew && (
                        <span className={cn("ml-0.5 normal-case", isSelected ? "text-white/70" : "text-gold-dark")}>
                          new
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center justify-end gap-2 mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSuggestion(null)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={apply} disabled={saving || selected.size === 0}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                  Add selected
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <Badge variant="muted">No suggestions</Badge>
              <Button variant="ghost" size="sm" onClick={runSuggest} disabled={loading}>
                Try again
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
