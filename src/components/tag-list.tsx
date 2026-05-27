import { Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"

/**
 * Renders a contact's tags as badges. Tags in `aiTags` were applied by the
 * background auto-tagger and not yet confirmed by a human, so they carry a small
 * sparkle marker — staff can see at a glance what the AI added vs. what they (or
 * a teammate) set themselves. `tags` is the display source of truth; `aiTags` is
 * the provenance subset.
 */
export function TagList({
  tags,
  aiTags = [],
  emptyText = "No tags yet",
}: {
  tags: string[] | null
  aiTags?: string[] | null
  emptyText?: string
}) {
  if (!tags || tags.length === 0) {
    return <p className="text-small text-ink-muted italic">{emptyText}</p>
  }
  const ai = new Set(aiTags ?? [])
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const isAi = ai.has(t)
        return (
          <Badge
            key={t}
            variant="muted"
            title={isAi ? "Auto-added by AI — not yet confirmed" : undefined}
          >
            {isAi && <Sparkles size={10} className="text-gold -ml-0.5 shrink-0" aria-hidden />}
            {t}
          </Badge>
        )
      })}
    </div>
  )
}
