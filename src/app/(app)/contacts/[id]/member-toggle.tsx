"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { UserCheck, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Toggle a contact's membership. The header badge reflects the saved state;
 * this is the action that flips it. Optimistic, with rollback on failure.
 */
export function MemberToggle({
  contactId,
  isMember,
}: {
  contactId: string
  isMember: boolean
}) {
  const router = useRouter()
  const [member, setMember] = useState(isMember)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    const next = !member
    setSaving(true)
    setMember(next)
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_member: next }),
      })
      if (!res.ok) {
        setMember(!next)
        const j = await res.json().catch(() => null)
        toast.error(`Couldn’t update: ${j?.error ?? res.status}`)
      } else {
        toast.success(next ? "Marked as member" : "Removed member status")
        router.refresh()
      }
    } catch {
      setMember(!next)
      toast.error("Couldn’t update membership")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Button
      variant={member ? "secondary" : "ghost"}
      size="sm"
      onClick={toggle}
      disabled={saving}
    >
      {member ? <UserCheck size={14} /> : <UserPlus size={14} />}
      {member ? "Remove member" : "Mark as member"}
    </Button>
  )
}
