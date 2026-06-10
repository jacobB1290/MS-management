import type { Metadata } from "next"
import Link from "next/link"
import { format } from "date-fns"
import { Plus, Mail, MessageSquare } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { PageMasthead } from "@/components/ui/page-masthead"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { TableCard, Table, Th, Tr, Td } from "@/components/ui/table"

export const metadata: Metadata = { title: "Campaigns" }

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "danger" | "muted" | "gold"> = {
  draft: "muted",
  scheduled: "gold",
  sending: "gold",
  done: "success",
  failed: "danger",
  cancelled: "muted",
}

export default async function CampaignsPage() {
  await requireStaff()
  const supabase = await createSupabaseServerClient()
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, channel, status, scheduled_at, started_at, completed_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100)

  return (
    <PageScaffold
      header={
        <PageMasthead
          title="Campaigns"
          description="One-off SMS and email announcements to a chosen audience."
          actions={
            <Link href="/campaigns/new" aria-label="New campaign" className="btn-icon-action">
              <Plus size={20} strokeWidth={2.5} />
            </Link>
          }
        />
      }
    >
      {!campaigns || campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          body="Send a one-off announcement to a tagged audience over SMS or email. Opted-out contacts are automatically excluded."
        />
      ) : (
        <TableCard className="mt-6">
          <Table>
            <thead>
              <tr className="border-b border-ink-hairline">
                <Th>Name</Th>
                <Th className="hidden md:table-cell">Channel</Th>
                <Th>Status</Th>
                <Th className="hidden md:table-cell" data-dynamic>
                  Created
                </Th>
                <Th className="hidden lg:table-cell" data-dynamic>
                  Schedule
                </Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link
                      href={`/campaigns/${c.id}`}
                      prefetch
                      className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline"
                    >
                      {/* Below md the Channel column is hidden; the icon rides
                          along with the name so mobile still shows the lane. */}
                      <span className="text-ink-faint md:hidden">
                        {c.channel === "sms" ? <MessageSquare size={14} /> : <Mail size={14} />}
                      </span>
                      {c.name}
                    </Link>
                  </Td>
                  <Td className="hidden md:table-cell">
                    <span className="inline-flex items-center gap-1.5 text-ink-muted">
                      {c.channel === "sms" ? <MessageSquare size={14} /> : <Mail size={14} />}
                      {c.channel.toUpperCase()}
                    </span>
                  </Td>
                  <Td>
                    <Badge variant={STATUS_VARIANT[c.status] ?? "muted"}>
                      {c.status}
                    </Badge>
                  </Td>
                  <Td className="hidden text-ink-muted md:table-cell" data-dynamic>
                    {format(new Date(c.created_at), "MMM d")}
                  </Td>
                  <Td className="hidden text-ink-muted lg:table-cell" data-dynamic>
                    {c.scheduled_at
                      ? format(new Date(c.scheduled_at), "MMM d, p")
                      : c.started_at
                        ? `Started ${format(new Date(c.started_at), "MMM d, p")}`
                        : "—"}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}
    </PageScaffold>
  )
}
