"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { StoredMedia } from "@/server/media/storage"

const QUOTA_BYTES = 1024 * 1024 * 1024 // 1 GB Supabase free-tier storage

export function StoragePanel({
  files,
  totalBytes,
}: {
  files: StoredMedia[]
  totalBytes: number
}) {
  const router = useRouter()
  const [deleting, setDeleting] = useState<string | null>(null)
  const pct = Math.min(100, (totalBytes / QUOTA_BYTES) * 100)

  async function remove(name: string) {
    if (
      !confirm(
        "Delete this file? If it was sent in a past message, that preview will break.",
      )
    )
      return
    setDeleting(name)
    try {
      const res = await fetch("/api/media/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Delete failed: ${j?.error ?? res.status}`)
      } else {
        toast.success("Deleted.")
        router.refresh()
      }
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center justify-between text-small mb-1.5">
          <span className="text-ink-muted" data-dynamic>
            {formatBytes(totalBytes)} of 1 GB used
          </span>
          <span className="text-ink-faint" data-dynamic>
            {files.length} file{files.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="h-2 rounded-pill bg-surface overflow-hidden">
          <div className="h-full bg-gold transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {files.length === 0 ? (
        <p className="text-small text-ink-faint">
          No media uploaded yet. Attachments you send in the inbox or on a
          campaign show up here.
        </p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {files.map((f) => (
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
