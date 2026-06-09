import type { Metadata } from "next"
import Link from "next/link"
import { format } from "date-fns"
import { Plus, Mail, MessageSquare } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { PageMasthead } from "@/components/ui/page-masthead"
import { cn } from "@/lib/utils"

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
    <div className="flex flex-col h-full min-h-0">
      {/* Header matches the other tabs: the + stays in the same top-right spot
          across tab switches, and on md+ the masthead carries the page identity
          (below md the mobile topbar already says "Campaigns"). Campaigns has
          no search by design. */}
      <div className="shrink-0 px-4 md:px-8 pt-4 pb-3 md:pb-4 border-b border-ink-hairline bg-bg">
        <div className="flex items-center justify-end gap-3 md:items-start md:justify-between">
          <PageMasthead
            title="Campaigns"
            description="One-off SMS and email announcements to a chosen audience."
          />
          <Link href="/campaigns/new" aria-label="New campaign" className="btn-icon-action">
            <Plus size={20} strokeWidth={2.5} />
          </Link>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-6 md:pb-8">
        {!campaigns || campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns yet"
            body="Send a one-off announcement to a tagged audience over SMS or email. Opted-out contacts are automatically excluded."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-ink-hairline bg-white">
            <table className="w-full text-small">
              <thead>
                <tr className="text-left text-ink-faint border-b border-ink-hairline">
                  <th className="font-medium px-4 py-3">Name</th>
                  <th className="font-medium px-4 py-3 hidden md:table-cell">Channel</th>
                  <th className="font-medium px-4 py-3">Status</th>
                  <th className="font-medium px-4 py-3 hidden md:table-cell" data-dynamic>
                    Created
                  </th>
                  <th className="font-medium px-4 py-3 hidden lg:table-cell" data-dynamic>
                    Schedule
                  </th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-ink-hairline last:border-b-0 hover:bg-surface transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/campaigns/${c.id}`}
                        prefetch
                        className="font-medium text-ink hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="inline-flex items-center gap-1.5 text-ink-muted">
                        {c.channel === "sms" ? <MessageSquare size={14} /> : <Mail size={14} />}
                        {c.channel.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[c.status] ?? "muted"}>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden md:table-cell" data-dynamic>
                      {format(new Date(c.created_at), "MMM d")}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-ink-muted hidden lg:table-cell",
                      )}
                      data-dynamic
                    >
                      {c.scheduled_at
                        ? format(new Date(c.scheduled_at), "MMM d, p")
                        : c.started_at
                          ? `Started ${format(new Date(c.started_at), "MMM d, p")}`
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
