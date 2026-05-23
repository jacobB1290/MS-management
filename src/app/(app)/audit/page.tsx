import type { Metadata } from "next"
import { format } from "date-fns"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"

export const metadata: Metadata = { title: "Audit log" }

const ACTION_VARIANT: Record<string, "default" | "success" | "warning" | "danger" | "muted" | "gold"> = {
  "auth.login": "muted",
  "auth.logout": "muted",
  "contact.create": "default",
  "contact.update": "default",
  "contact.delete": "danger",
  "contact.opt_out_sms": "warning",
  "contact.opt_in_sms": "default",
  "contact.unsubscribe_email": "warning",
  "message.send": "gold",
  "message.send_failed": "danger",
  "campaign.start": "gold",
  "campaign.cancel": "warning",
  "form.submitted": "success",
  "user.invite": "default",
  "user.role_change": "warning",
}

export default async function AuditPage() {
  await requireAdmin()
  const supabase = await createSupabaseServerClient()
  const { data: rows } = await supabase
    .from("audit_log")
    .select("id, action, actor_user_id, target_table, target_id, created_at, ip")
    .order("created_at", { ascending: false })
    .limit(500)

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-6 md:pt-8 pb-4 bg-bg">
        <PageHeader
          eyebrow="Console"
          title="Audit log"
          info="Every privileged write — sends, opt-out toggles, contact edits, campaign starts, logins, invites. Reads are not logged; the threat is unauthorized writes, not legitimate viewing."
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-6 md:pb-8">
        {!rows || rows.length === 0 ? (
          <EmptyState
            title="No events yet"
            body="Once staff start using the console, every privileged action lands here."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-ink-hairline bg-white">
            <table className="w-full text-small">
              <thead>
                <tr className="text-left text-ink-faint border-b border-ink-hairline">
                  <th className="font-medium px-4 py-3" data-dynamic>When</th>
                  <th className="font-medium px-4 py-3">Action</th>
                  <th className="font-medium px-4 py-3 hidden md:table-cell">Actor</th>
                  <th className="font-medium px-4 py-3 hidden md:table-cell">Target</th>
                  <th className="font-medium px-4 py-3 hidden lg:table-cell">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-ink-hairline last:border-b-0 hover:bg-surface transition-colors"
                  >
                    <td className="px-4 py-3 text-ink-muted whitespace-nowrap" data-dynamic>
                      {format(new Date(r.created_at), "MMM d, p")}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={ACTION_VARIANT[r.action] ?? "muted"}>
                        {r.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden md:table-cell font-mono text-micro">
                      {r.actor_user_id?.slice(0, 8) ?? "system"}
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden md:table-cell font-mono text-micro">
                      {r.target_table && r.target_id
                        ? `${r.target_table}/${r.target_id.slice(0, 8)}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell font-mono text-micro">
                      {(r.ip as string | null) ?? "—"}
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
