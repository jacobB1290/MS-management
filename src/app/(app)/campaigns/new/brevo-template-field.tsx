"use client"
import { useState } from "react"
import { ExternalLink, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

// Designs are authored in Brevo's template editor; the CRM just picks one.
const EDITOR_URL = "https://app.brevo.com/templates/listing"

type BrevoTpl = {
  id: number
  name: string
  updatedAt: string | null
  subject: string | null
}

type LoadState = {
  configured: boolean
  error?: string
  templates: BrevoTpl[]
}

export function BrevoTemplateField({
  templateId,
  onTemplateId,
  onSubject,
}: {
  templateId: string
  onTemplateId: (id: string) => void
  onSubject: (subject: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [state, setState] = useState<LoadState>({ configured: true, templates: [] })

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/brevo/templates")
      const json = await res.json().catch(() => null)
      if (!json) {
        setState({ configured: true, error: `Error ${res.status}`, templates: [] })
      } else {
        setState({
          configured: json.configured ?? true,
          error: res.ok ? undefined : json.error ?? `Error ${res.status}`,
          templates: json.templates ?? [],
        })
      }
    } catch (e) {
      setState({ configured: true, error: e instanceof Error ? e.message : "load_failed", templates: [] })
    } finally {
      setLoading(false)
    }
  }

  function openBrowse() {
    setOpen(true)
    void load()
  }

  function selectTemplate(t: BrevoTpl) {
    onTemplateId(String(t.id))
    if (t.subject) onSubject(t.subject)
    setOpen(false)
    toast.success(`Using “${t.name}”.`)
  }

  return (
    <>
      <div className="flex items-end gap-3">
        <Input
          variant="quiet"
          id="template"
          value={templateId}
          inputMode="numeric"
          onChange={(e) => onTemplateId(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="e.g. 12"
          className="max-w-[160px] font-mono"
        />
        <Button type="button" variant="secondary" size="sm" onClick={openBrowse}>
          Browse
        </Button>
      </div>
      <a
        href={EDITOR_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 inline-flex items-center gap-1 text-small text-gold hover:underline underline-offset-2"
      >
        Open Brevo template editor
        <ExternalLink size={12} />
      </a>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Brevo templates</DialogTitle>
            <DialogDescription>
              Pick one to fill its ID and subject. Design new templates in Brevo,
              then refresh this list.
            </DialogDescription>
          </DialogHeader>

          {!state.configured ? (
            <div className="text-small text-ink-muted">
              <p className="mb-3">
                Brevo isn’t connected yet. Add BREVO_API_KEY to list your templates
                here. You can still design them in Brevo and paste an ID.
              </p>
              <a
                href={EDITOR_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-gold hover:underline underline-offset-2"
              >
                Open Brevo template editor <ExternalLink size={12} />
              </a>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void load()}
                  disabled={loading}
                  aria-label="Refresh list"
                >
                  <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
                </Button>
              </div>

              <div className="max-h-[min(50vh,360px)] overflow-y-auto -mx-1 px-1">
                {loading && state.templates.length === 0 ? (
                  <p className="py-6 text-center text-small text-ink-faint">Loading…</p>
                ) : state.error ? (
                  <p className="py-6 text-center text-small text-danger">
                    Couldn’t load templates: {state.error}
                  </p>
                ) : state.templates.length === 0 ? (
                  <p className="py-6 text-center text-small text-ink-faint">
                    No templates yet. Design one in Brevo, then refresh.
                  </p>
                ) : (
                  <ul className="divide-y divide-ink-hairline">
                    {state.templates.map((t) => {
                      const selected = String(t.id) === templateId
                      return (
                        <li key={t.id} className="flex items-center gap-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-body text-ink truncate">{t.name}</p>
                            <p className="text-micro text-ink-faint font-mono truncate">#{t.id}</p>
                          </div>
                          <Button
                            type="button"
                            variant={selected ? "ghost" : "secondary"}
                            size="sm"
                            onClick={() => selectTemplate(t)}
                            disabled={selected}
                          >
                            {selected ? "Selected" : "Use"}
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
