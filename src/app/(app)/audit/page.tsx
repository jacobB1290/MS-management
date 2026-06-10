import type { Metadata } from "next"
import { format } from "date-fns"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { BackButton } from "@/components/ui/back-button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { TableCard, Table, Th, Tr, Td } from "@/components/ui/table"

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
    <PageScaffold
      header={
        <PageHeader
          title="Audit log"
          backSlot={<BackButton label="Back" />}
          backMobileOnly
          info="Every privileged write is logged: sends, opt-out toggles, contact edits, campaign starts, logins, invites. Reads are not logged; the threat is unauthorized writes, not legitimate viewing."
        />
      }
    >
      {!rows || rows.length === 0 ? (
        <EmptyState
          title="No events yet"
          body="Once staff start using the console, every privileged action lands here."
        />
      ) : (
        <TableCard className="mt-6">
          <Table>
            <thead>
              <tr className="border-b border-ink-hairline">
                <Th className="w-44" data-dynamic>When</Th>
                <Th>Action</Th>
                <Th className="hidden md:table-cell">Actor</Th>
                <Th className="hidden md:table-cell">Target</Th>
                <Th className="hidden lg:table-cell">IP</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="text-ink-muted whitespace-nowrap w-44" data-dynamic>
                    {/* Zero-padded, fixed-width ("MMM dd, hh:mm a") so the column
                        width never changes as the time rolls over — the cell is
                        masked in the visual harness, and a varying width would
                        otherwise shift every column after it and flake the snapshot. */}
                    {format(new Date(r.created_at), "MMM dd, hh:mm a")}
                  </Td>
                  <Td>
                    <Badge variant={ACTION_VARIANT[r.action] ?? "muted"}>
                      {r.action}
                    </Badge>
                  </Td>
                  <Td className="text-ink-muted hidden md:table-cell font-mono text-micro">
                    {r.actor_user_id?.slice(0, 8) ?? "system"}
                  </Td>
                  <Td className="text-ink-muted hidden md:table-cell font-mono text-micro">
                    {r.target_table && r.target_id
                      ? `${r.target_table}/${r.target_id.slice(0, 8)}`
                      : "—"}
                  </Td>
                  <Td className="text-ink-muted hidden lg:table-cell font-mono text-micro">
                    {(r.ip as string | null) ?? "—"}
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
