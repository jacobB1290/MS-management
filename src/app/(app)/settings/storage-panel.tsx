"use client"
import { useState } from "react"
import { Trash2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { StoredMedia } from "@/server/media/storage"

const FILE_QUOTA_BYTES = 1024 * 1024 * 1024 // 1 GB Supabase free-tier file storage
const DB_QUOTA_BYTES = 500 * 1024 * 1024 // ~500 MB Supabase free-tier database

export function StoragePanel({
  files,
  totalBytes,
  dbBytes,
}: {
  files: StoredMedia[]
  totalBytes: number
  dbBytes: number
}) {
  const [deleting, setDeleting] = useState<string | null>(null)
  // Files + media usage held locally so a delete drops the tile and shrinks the
  // usage bar instantly; reseed when the server re-provides a fresh snapshot.
  const [list, setList] = useState<StoredMedia[]>(files)
  const [used, setUsed] = useState(totalBytes)
  const seedSig = `${files.length}:${totalBytes}`
  const [seed, setSeed] = useState(seedSig)
  if (seedSig !== seed) {
    setSeed(seedSig)
    setList(files)
    setUsed(totalBytes)
  }

  async function remove(name: string) {
    if (
      !confirm(
        "Delete this file? If it was sent in a past message, that preview will break.",
      )
    )
      return
    const target = list.find((f) => f.name === name)
    setDeleting(name)
    // Optimistic: drop the tile and shrink the usage bar now; restore on failure.
    const prevList = list
    const prevUsed = used
    setList((cur) => cur.filter((f) => f.name !== name))
    if (target) setUsed((u) => Math.max(0, u - target.size))
    try {
      const res = await fetch("/api/media/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        setList(prevList)
        setUsed(prevUsed)
        toast.error(`Delete failed: ${j?.error ?? res.status}`)
      } else {
        toast.success("Deleted.")
      }
    } catch {
      setList(prevList)
      setUsed(prevUsed)
      toast.error("Delete failed")
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div>
      <div className="space-y-3 mb-4">
        <UsageBar
          label="Database (contacts, messages, campaigns)"
          used={dbBytes}
          quota={DB_QUOTA_BYTES}
          quotaLabel="500 MB"
        />
        <UsageBar
          label="Media files"
          used={used}
          quota={FILE_QUOTA_BYTES}
          quotaLabel="1 GB"
          aside={`${list.length} file${list.length === 1 ? "" : "s"}`}
        />
      </div>

      {list.length === 0 ? (
        <p className="text-small text-ink-faint">
          No media uploaded yet. Attachments you send in the inbox or on a
          campaign show up here.
        </p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {list.map((f) => (
            <li
              key={f.name}
              className="rounded-md border border-ink-hairline overflow-hidden bg-surface"
            >
              <a href={f.url} target="_blank" rel="noreferrer" className="block">
                {f.isVideo ? (
                  <video src={f.url} className="w-full h-28 object-cover" muted preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt="" className="w-full h-28 object-cover" />
                )}
              </a>
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-micro text-ink-faint" data-dynamic>
                  {formatBytes(f.size)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(f.name)}
                  disabled={deleting === f.name}
                  aria-label="Delete file"
                  className="inline-flex items-center justify-center h-7 w-7 rounded-pill text-ink-faint hover:text-danger transition-colors"
                >
                  {deleting === f.name ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function UsageBar({
  label,
  used,
  quota,
  quotaLabel,
  aside,
}: {
  label: string
  used: number
  quota: number
  quotaLabel: string
  aside?: string
}) {
  const pct = Math.min(100, (used / quota) * 100)
  const over = used > quota
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-small mb-1.5">
        <span className="text-ink-muted truncate">{label}</span>
        <span className="text-ink-faint shrink-0" data-dynamic>
          {aside ? `${aside} · ` : ""}
          {formatBytes(used)} / {quotaLabel}
        </span>
      </div>
      <div className="h-2 rounded-pill bg-surface overflow-hidden">
        <div
          className={`h-full transition-all ${over ? "bg-danger" : "bg-gold"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
