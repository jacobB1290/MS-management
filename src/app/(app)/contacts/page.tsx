import type { Metadata } from "next"
import Link from "next/link"
import { format } from "date-fns"
import { Plus } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { formatPhone } from "@/lib/utils"
import { ContactsSearch } from "./contacts-search"

export const metadata: Metadata = { title: "Contacts" }

interface PageProps {
  searchParams: Promise<{ q?: string; tag?: string }>
}

export default async function ContactsPage({ searchParams }: PageProps) {
  await requireStaff()
  const { q, tag } = await searchParams
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from("contact_summary")
    .select("id, name, phone, email, tags, sms_opted_out_at, email_unsubscribed_at, last_message_at, created_at")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(500)

  if (q) {
    // Restrict to safe chars before interpolating into PostgREST's `.or()` —
    // commas/parens would let a caller break out of the filter list.
    const safe = q.replace(/[^a-zA-Z0-9 @+\-.]/g, "").slice(0, 80)
    if (safe) {
      query = query.or(
        `name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`,
      )
    }
  }
  if (tag) {
    const safeTag = tag.replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 40)
    if (safeTag) {
      query = query.contains("tags", [safeTag])
    }
  }

  const { data: contacts } = await query

  return (
    <div className="px-4 md:px-8 py-6 md:py-8">
      <PageHeader
        eyebrow="Directory"
        title="Contacts"
        actions={
          <Button asChild>
            <Link href="/contacts/new">
              <Plus size={16} />
              New contact
            </Link>
          </Button>
        }
      />

      <div className="mt-6">
        <ContactsSearch initialQuery={q ?? ""} initialTag={tag ?? ""} />
      </div>

      <div className="mt-6">
        {!contacts || contacts.length === 0 ? (
          <EmptyState
            title={q || tag ? "No matches" : "No contacts yet"}
            body={
              q || tag
                ? "Try a different search or clear the filter."
                : "Add contacts manually, or wire up the public website form to create them automatically."
            }
            action={
              !q && !tag && (
                <Button asChild>
                  <Link href="/contacts/new">Add the first contact</Link>
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-ink-hairline bg-white">
            <table className="w-full text-small">
              <thead>
                <tr className="text-left text-ink-faint border-b border-ink-hairline">
                  <th className="font-medium px-4 py-3 w-12"></th>
                  <th className="font-medium px-4 py-3">Name</th>
                  <th className="font-medium px-4 py-3 hidden md:table-cell">Phone</th>
                  <th className="font-medium px-4 py-3 hidden lg:table-cell">Email</th>
                  <th className="font-medium px-4 py-3 hidden md:table-cell">Tags</th>
                  <th className="font-medium px-4 py-3">Status</th>
                  <th className="font-medium px-4 py-3 hidden lg:table-cell" data-dynamic>
                    Last activity
                  </th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-ink-hairline last:border-b-0 hover:bg-surface transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Avatar name={c.name ?? c.phone ?? c.email} size="sm" />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/contacts/${c.id}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {c.name ?? formatPhone(c.phone) ?? c.email ?? "Unknown"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden md:table-cell">
                      {c.phone ? formatPhone(c.phone) : "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">
                      {c.email ?? "—"}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {(c.tags ?? []).slice(0, 3).map((t: string) => (
                          <Badge key={t} variant="muted">
                            {t}
                          </Badge>
                        ))}
                        {(c.tags?.length ?? 0) > 3 && (
                          <Badge variant="muted">+{(c.tags?.length ?? 0) - 3}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.sms_opted_out_at && <Badge variant="warning">STOP</Badge>}
                        {c.email_unsubscribed_at && <Badge variant="muted">UNSUB</Badge>}
                        {!c.sms_opted_out_at && !c.email_unsubscribed_at && (
                          <span className="text-ink-faint">—</span>
                        )}
                      </div>
                    </td>
                    <td
                      className="px-4 py-3 text-ink-muted hidden lg:table-cell"
                      data-dynamic
                    >
                      {c.last_message_at
                        ? format(new Date(c.last_message_at), "MMM d")
                        : c.created_at
                          ? format(new Date(c.created_at), "MMM d")
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
