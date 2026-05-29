"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import { RefreshCw, Pencil, Trash2, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export interface KnowledgeEntry {
  id: string
  title: string
  body: string
  source: string
  source_url: string | null
  updated_at: string
}

export interface KnowledgeSyncInfo {
  ran_at: string
  pages: number
  inserted: number
  updated: number
  ok: boolean
}

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-ink-hairline bg-white px-3 py-2 text-small text-ink min-h-11 disabled:opacity-50 disabled:cursor-not-allowed"

export function ChurchKnowledgePanel({
  entries,
  lastSync,
  isAdmin,
}: {
  entries: KnowledgeEntry[]
  lastSync: KnowledgeSyncInfo | null
  isAdmin: boolean
}) {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [adding, setAdding] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editBody, setEditBody] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  async function add() {
    if (!title.trim() || !body.trim()) return
    setAdding(true)
    try {
      const res = await fetch("/api/ai/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Couldn’t add: ${j?.error ?? res.status}`)
      } else {
        toast.success("Knowledge added")
        setTitle("")
        setBody("")
        router.refresh()
      }
    } finally {
      setAdding(false)
    }
  }

  async function sync() {
    setSyncing(true)
    try {
      const res = await fetch("/api/ai/knowledge/sync", { method: "POST" })
      const j = await res.json().catch(() => null)
      const s = j?.summary
      if (!res.ok) {
        toast.error(`Sync failed: ${j?.error ?? res.status}`)
      } else if (s && !s.ok) {
        toast.warning(`Synced with issues: ${s.pages} pages, ${s.errors?.length ?? 0} errors`)
      } else {
        toast.success(`Synced ${s?.pages ?? 0} pages (${s?.inserted ?? 0} new, ${s?.updated ?? 0} updated)`)
      }
      router.refresh()
    } finally {
      setSyncing(false)
    }
  }

  function startEdit(e: KnowledgeEntry) {
    setEditingId(e.id)
    setEditTitle(e.title)
    setEditBody(e.body)
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim() || !editBody.trim()) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, body: editBody }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Couldn’t save: ${j?.error ?? res.status}`)
      } else {
        toast.success("Saved")
        setEditingId(null)
        router.refresh()
      }
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this knowledge entry? The AI will no longer use it.")) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Couldn’t delete: ${j?.error ?? res.status}`)
      } else {
        toast.success("Deleted")
        router.refresh()
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-small text-ink-faint leading-prose">
        Facts the AI draft assistant can look up when replying (service times, Bible
        studies, ministries, location, beliefs). Synced from ms.church, plus anything
        you add here.
      </p>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-hairline pb-4">
          <Button size="sm" variant="secondary" onClick={sync} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? "animate-spin" : undefined} />
            {syncing ? "Syncing…" : "Sync from website"}
          </Button>
          <p className="text-small text-ink-faint" data-dynamic>
            {lastSync
              ? `Last synced ${format(new Date(lastSync.ran_at), "PPp")} · ${lastSync.pages} pages`
              : "Never synced from the website yet."}
          </p>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-small text-ink-faint">
          No church info yet.{" "}
          {isAdmin ? "Sync from the website or add an entry below." : "Add an entry below."}
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => {
            const isWebsite = e.source === "website"
            const editing = editingId === e.id
            return (
              <li
                key={e.id}
                className="rounded-md border border-ink-hairline bg-surface p-4"
              >
                {editing ? (
                  <div className="space-y-2">
                    <input
                      className={INPUT_CLASS}
                      value={editTitle}
                      onChange={(ev) => setEditTitle(ev.target.value)}
                      maxLength={200}
                    />
                    <textarea
                      className={`${INPUT_CLASS} min-h-32`}
                      value={editBody}
                      onChange={(ev) => setEditBody(ev.target.value)}
                      maxLength={8000}
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => saveEdit(e.id)} disabled={busyId === e.id}>
                        {busyId === e.id ? "Saving…" : "Save"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-body text-ink font-medium">{e.title}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant={isWebsite ? "gold" : "muted"}>
                            {isWebsite ? "from website" : "staff"}
                          </Badge>
                          {isWebsite && e.source_url && (
                            <a
                              href={e.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-small text-ink-faint hover:text-ink"
                            >
                              <ExternalLink size={12} />
                              <span className="truncate max-w-56">{prettyUrl(e.source_url)}</span>
                            </a>
                          )}
                        </div>
                      </div>
                      {!isWebsite && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(e)}
                            className="rounded-md p-1.5 text-ink-faint hover:bg-white hover:text-ink"
                            aria-label="Edit"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(e.id)}
                            disabled={busyId === e.id}
                            className="rounded-md p-1.5 text-ink-faint hover:bg-white hover:text-danger disabled:opacity-50"
                            aria-label="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-small text-ink-muted leading-prose whitespace-pre-wrap line-clamp-4">
                      {e.body}
                    </p>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="border-t border-ink-hairline pt-4 space-y-2">
        <p className="text-label text-ink-faint">Add an entry</p>
        <input
          className={INPUT_CLASS}
          placeholder="Title (e.g. Thursday Bible study)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <textarea
          className={`${INPUT_CLASS} min-h-24`}
          placeholder="What should the AI know? (e.g. Thursdays at 6pm at the church, 45 minutes, free coffee, all welcome.)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={8000}
        />
        <Button size="sm" onClick={add} disabled={adding || !title.trim() || !body.trim()}>
          {adding ? "Adding…" : "Add entry"}
        </Button>
      </div>
    </div>
  )
}

function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}`.replace(/\/$/, "")
  } catch {
    return url
  }
}
