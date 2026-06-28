"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { SermonSettings } from "@/lib/sermon-settings"

/**
 * Settings → Services. The two auto-publish modes: should a completed
 * segmentation skip the human review gate and go straight live on ms.church?
 * One toggle for unattended runs (the Monday cron, back-catalog drain, and a
 * Claude-Code-session finalize) and one for a hand-kicked "Run now". Both off by
 * default, which is the historical behavior (everything lands in review).
 */

type Row = {
  key: keyof SermonSettings
  label: string
  description: string
}

const ROWS: Row[] = [
  {
    key: "autoPublishAutomatic",
    label: "Auto-publish automatic runs",
    description:
      "The Sunday cron, the back-catalog drain, and Claude Code session finalize publish without stopping for review.",
  },
  {
    key: "autoPublishManual",
    label: "Auto-publish manual runs",
    description: "A “Run now” you kick by hand publishes immediately instead of landing in review.",
  },
]

export function ServicesSettingsPanel({ settings }: { settings: SermonSettings }) {
  const router = useRouter()
  const [draft, setDraft] = useState<SermonSettings>(settings)
  const [saving, setSaving] = useState(false)

  const dirty = ROWS.some((r) => draft[r.key] !== settings[r.key])
  const anyOn = draft.autoPublishAutomatic || draft.autoPublishManual

  function toggle(key: keyof SermonSettings, value: boolean) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch("/api/settings/sermons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Couldn’t save: ${j?.error ?? res.status}`)
      } else {
        toast.success("Services settings updated")
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {ROWS.map((row) => (
        <div key={row.key} className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-body text-ink font-medium">{row.label}</p>
            <p className="text-small text-ink-faint leading-prose mt-0.5">{row.description}</p>
          </div>
          <Switch
            checked={draft[row.key]}
            onCheckedChange={(v) => toggle(row.key, v)}
            aria-label={row.label}
          />
        </div>
      ))}

      <div className="flex items-center gap-3 border-t border-ink-hairline pt-4">
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <p className="text-small text-ink-faint">
          {anyOn
            ? "Auto-published services appear on ms.church within about 5 minutes, with no review step."
            : "Both off: every run lands in review for a person to publish."}
        </p>
      </div>
    </div>
  )
}
