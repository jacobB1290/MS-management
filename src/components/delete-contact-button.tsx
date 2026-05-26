"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const CONFIRM_WORD = "DELETE"

interface DeleteContactButtonProps {
  contactId: string
  /** Resolved label for the copy — name, else phone, else email. */
  contactName: string
  /** Total messages in the thread, for the blast-radius line. */
  messageCount?: number
  /** Where to send the operator after a successful delete. */
  redirectTo: string
  /** Stretch the trigger to fill its column (the narrow inbox panel). */
  fullWidth?: boolean
  className?: string
}

/**
 * Hard-deletes a contact (and, via FK cascade, their entire message thread)
 * through the admin-only DELETE /api/contacts/[id] endpoint. Because the action
 * is irreversible and bulk, it gates behind a type-the-word confirmation rather
 * than a single click. Render it only for admins — the endpoint enforces the
 * same, this just hides a button that would 403.
 */
export function DeleteContactButton({
  contactId,
  contactName,
  messageCount,
  redirectTo,
  fullWidth = false,
  className,
}: DeleteContactButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)

  const canDelete = confirmText.trim().toUpperCase() === CONFIRM_WORD

  const threadCopy =
    messageCount && messageCount > 0
      ? `all ${messageCount} message${messageCount === 1 ? "" : "s"} in this thread`
      : "their entire message thread"

  function onOpenChange(next: boolean) {
    if (deleting) return // never let a dismiss interrupt an in-flight delete
    setOpen(next)
    if (!next) setConfirmText("")
  }

  async function handleDelete() {
    if (!canDelete || deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/contacts/${contactId}`, { method: "DELETE" })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(
          res.status === 403
            ? "Only admins can delete contacts."
            : `Delete failed: ${j?.error ?? res.status}`,
        )
        setDeleting(false)
        return
      }
      toast.success("Contact deleted")
      // Leave the now-dead route first, then refresh server data behind it.
      router.push(redirectTo)
      router.refresh()
    } catch (err) {
      toast.error(`Network error: ${err instanceof Error ? err.message : String(err)}`)
      setDeleting(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="danger"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn(fullWidth && "w-full", className)}
      >
        <Trash2 size={14} />
        Delete contact
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete {contactName}?</DialogTitle>
            <DialogDescription>
              This permanently removes the contact and {threadCopy}. This can’t
              be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label htmlFor="confirm-delete-contact" className="text-label text-ink-faint">
              Type {CONFIRM_WORD} to confirm
            </label>
            <Input
              id="confirm-delete-contact"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canDelete) void handleDelete()
              }}
              placeholder={CONFIRM_WORD}
              autoComplete="off"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDelete}
              disabled={!canDelete || deleting}
            >
              {deleting ? "Deleting…" : "Delete contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
