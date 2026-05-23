"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

type Member = {
  user_id: string
  role: string
  display_name: string | null
  created_at: string
}

export function TeamPanel({ team, currentUserId }: { team: Member[]; currentUserId: string }) {
  const router = useRouter()
  const [showInvite, setShowInvite] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<{ userId: string; name: string } | null>(null)
  const [removing, setRemoving] = useState(false)

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setInviting(true)
    const fd = new FormData(e.currentTarget)
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fd.get("email"),
          role: fd.get("role"),
          display_name: fd.get("display_name") || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(`Invite failed: ${json.error ?? res.status}`)
      } else {
        toast.success("Invitation sent")
        setShowInvite(false)
        router.refresh()
      }
    } finally {
      setInviting(false)
    }
  }

  async function remove() {
    if (!pendingRemove) return
    setRemoving(true)
    try {
      const res = await fetch(`/api/team/${pendingRemove.userId}`, { method: "DELETE" })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Failed: ${j?.error ?? res.status}`)
      } else {
        toast.success("Removed")
        router.refresh()
      }
    } finally {
      setRemoving(false)
      setPendingRemove(null)
    }
  }

  async function setRole(userId: string, role: "admin" | "member") {
    const res = await fetch(`/api/team/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => null)
      toast.error(`Failed: ${j?.error ?? res.status}`)
    } else {
      router.refresh()
    }
  }

  return (
    <div>
      <ul className="divide-y divide-ink-hairline">
        {team.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 py-3">
            <Avatar name={m.display_name} size="md" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-ink truncate">
                {m.display_name ?? m.user_id}
                {m.user_id === currentUserId && (
                  <span className="ml-2 text-micro text-ink-faint">(you)</span>
                )}
              </p>
              <Badge variant={m.role === "admin" ? "gold" : "muted"} className="mt-0.5">
                {m.role}
              </Badge>
            </div>
            {m.user_id !== currentUserId && (
              <div className="flex items-center gap-2">
                {m.role === "admin" ? (
                  <Button variant="ghost" size="sm" onClick={() => setRole(m.user_id, "member")}>
                    Demote
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setRole(m.user_id, "admin")}>
                    Promote
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setPendingRemove({
                      userId: m.user_id,
                      name: m.display_name ?? "this user",
                    })
                  }
                  aria-label={`Remove ${m.display_name ?? "user"}`}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {!showInvite ? (
        <Button variant="ghost" size="sm" onClick={() => setShowInvite(true)} className="mt-3">
          <Plus size={14} />
          Invite someone
        </Button>
      ) : (
        <form onSubmit={invite} className="mt-4 space-y-3 rounded-md border border-ink-hairline bg-surface p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input name="email" type="email" placeholder="email@morningstar.org" required />
            <Input name="display_name" placeholder="Display name (optional)" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <select
              name="role"
              defaultValue="member"
              className="rounded-md border border-ink-hairline bg-white px-3 py-2 text-small text-ink min-h-11"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowInvite(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={inviting}>
                {inviting ? "Sending…" : "Send invite"}
              </Button>
            </div>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRemove(null)
        }}
        title={`Remove ${pendingRemove?.name ?? "this user"}?`}
        description="They can still sign in but won’t have access to the console."
        confirmLabel="Remove"
        destructive
        loading={removing}
        onConfirm={remove}
      />
    </div>
  )
}
