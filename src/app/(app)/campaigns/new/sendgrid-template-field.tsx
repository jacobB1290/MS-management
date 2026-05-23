"use client"
import { useState } from "react"
import { ExternalLink, Plus, Loader2, RefreshCw } from "lucide-react"
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

const BUILDER_URL = "https://mc.sendgrid.com/dynamic-templates"

type SgTemplate = {
  id: string
  name: string
  updatedAt: string | null
  subject: string | null
}

type LoadState = {
  configured: boolean
  error?: string
  templates: SgTemplate[]
}

export function SendgridTemplateField({
  templateId,
  onTemplateId,
  onSubject,
  campaignName,
}: {
  templateId: string
  onTemplateId: (id: string) => void
  onSubject: (subject: string) => void
  campaignName: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [state, setState] = useState<LoadState>({ configured: true, templates: [] })

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/sendgrid/templates")
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

  function selectTemplate(t: SgTemplate) {
    onTemplateId(t.id)
    if (t.subject) onSubject(t.subject)
    setOpen(false)
    toast.success(`Using “${t.name}”.`)
  }

  async function createNew() {
    setCreating(true)
    try {
      const res = await fetch("/api/sendgrid/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: campaignName || "Untitled template" }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.id) {
        toast.error(`Couldn't create: ${json?.error ?? res.status}`)
        return
      }
      onTemplateId(json.id)
      setOpen(false)
      window.open(BUILDER_URL, "_blank", "noopener,noreferrer")
      toast.success("Template created and ID filled. Design it in the SendGrid tab.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          id="template"
          value={templateId}
          onChange={(e) => onTemplateId(e.target.value)}
          placeholder="d-abc123…"
          className="font-mono flex-1"
        />
        <Button type="button" variant="secondary" size="sm" onClick={openBrowse}>
          Browse
        </Button>
      </div>
      <a
        href={BUILDER_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 inline-flex items-center gap-1 text-small text-gold hover:underline underline-offset-2"
      >
        Open SendGrid builder
        <ExternalLink size={12} />
      </a>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SendGrid templates</DialogTitle>
            <DialogDescription>
              Pick one to fill the ID and subject, or create a new one and design
              it in SendGrid.
            </DialogDescription>
          </DialogHeader>

          {!state.configured ? (
            <div className="text-small text-ink-muted">
              <p className="mb-3">
                SendGrid isn’t connected yet. Add SENDGRID_API_KEY to list your
                templates here. You can still design and copy an ID from the
                builder.
              </p>
              <a
                href={BUILDER_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-gold hover:underline underline-offset-2"
              >
                Open SendGrid builder <ExternalLink size={12} />
              </a>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <Button type="button" size="sm" onClick={createNew} disabled={creating}>
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {creating ? "Creating…" : "Create new template"}
                </Button>
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
                    No templates yet. Create one above to get started.
                  </p>
                ) : (
                  <ul className="divide-y divide-ink-hairline">
                    {state.templates.map((t) => {
                      const selected = t.id === templateId
                      return (
                        <li key={t.id} className="flex items-center gap-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-body text-ink truncate">{t.name}</p>
                            <p className="text-micro text-ink-faint font-mono truncate">{t.id}</p>
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
