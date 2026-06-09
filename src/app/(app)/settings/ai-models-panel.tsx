"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  AI_MODEL_CHOICES,
  AI_EFFORT_CHOICES,
  AI_FEATURE_META,
  AI_FEATURES,
  effortLevelsForModel,
  clampEffort,
  type AiFeature,
  type AiFeatureConfig,
  type AiModelChoice,
} from "@/lib/ai-models"

const SELECT_CLASS =
  "mt-1 w-full rounded-md border border-ink-hairline bg-white px-3 py-2 text-small text-ink min-h-11 disabled:opacity-50 disabled:cursor-not-allowed"

export function AiModelsPanel({
  config,
  choices = AI_MODEL_CHOICES,
}: {
  config: Record<AiFeature, AiFeatureConfig>
  /** Live picker options (latest per class) from the Models API; falls back offline. */
  choices?: readonly AiModelChoice[]
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(config)
  const [saving, setSaving] = useState(false)

  const dirty = AI_FEATURES.some(
    (f) => draft[f].model !== config[f].model || draft[f].effort !== config[f].effort,
  )

  function update(feature: AiFeature, patch: Partial<AiFeatureConfig>) {
    setDraft((d) => {
      const next = { ...d[feature], ...patch }
      // Switching the model can strip the current effort tier (e.g. Opus→Sonnet
      // drops `xhigh`/`max`). Clamp so the select never holds an option the new
      // model can't take — and so we never persist an unsupported tier.
      if (patch.model) next.effort = clampEffort(next.model, next.effort)
      return { ...d, [feature]: next }
    })
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Couldn’t save: ${j?.error ?? res.status}`)
      } else {
        toast.success("AI models updated")
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {AI_FEATURES.map((feature) => {
        const meta = AI_FEATURE_META[feature]
        const fc = draft[feature]
        const levels = effortLevelsForModel(fc.model)
        const effortOn = levels.length > 0
        // When supported, show only this model's tiers; when not, show the full
        // (disabled) list so the control still reads as an effort selector.
        const effortOptions = effortOn
          ? AI_EFFORT_CHOICES.filter((x) => levels.includes(x.id))
          : AI_EFFORT_CHOICES
        return (
          <div
            key={feature}
            className="grid grid-cols-2 sm:grid-cols-[1fr_11rem_8rem] gap-x-3 gap-y-2 sm:items-end"
          >
            <div className="col-span-2 sm:col-span-1 min-w-0">
              <p className="text-body text-ink font-medium">{meta.label}</p>
              <p className="text-small text-ink-faint leading-prose mt-0.5">
                {meta.description}
              </p>
            </div>
            <label className="block">
              <span className="text-label text-ink-faint">Model</span>
              <select
                className={SELECT_CLASS}
                value={fc.model}
                onChange={(e) => update(feature, { model: e.target.value })}
              >
                {choices.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-label text-ink-faint">Effort</span>
              <select
                className={SELECT_CLASS}
                value={fc.effort}
                disabled={!effortOn}
                onChange={(e) =>
                  update(feature, { effort: e.target.value as AiFeatureConfig["effort"] })
                }
              >
                {effortOptions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )
      })}

      <div className="flex items-center gap-3 border-t border-ink-hairline pt-4">
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save models"}
        </Button>
        <p className="text-small text-ink-faint">
          Effort tunes reasoning depth (Low → Max). Opus exposes the full range;
          Sonnet stops at High; Haiku ignores it.
        </p>
      </div>
    </div>
  )
}
