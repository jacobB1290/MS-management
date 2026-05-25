import type { Metadata } from "next"
import Link from "next/link"
import { format } from "date-fns"
import { Plus, HeartHandshake } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { formatPhone } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { PrayerActions } from "./prayer-actions"
import { PRAYER_STATUS_META, PRAYER_STATUS_ORDER, type PrayerStatus } from "./status"

export const metadata: Metadata = { title: "Prayer requests" }

const FILTERS = ["all", ...PRAYER_STATUS_ORDER] as const

export default async function PrayerPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await requireStaff()
  const { status } = await searchParams
  const active = (FILTERS as readonly string[]).includes(status ?? "") ? (status as string) : "all"

  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from("prayer_requests")
    .select("id, body, status, requester_name, created_at, contact_id, contact:contacts(id, name, phone)")
    .order("created_at", { ascending: false })
    .limit(200)
  if (active !== "all") query = query.eq("status", active)
  const { data: requests } = await query

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-6 md:pt-8 pb-4 bg-bg max-w-4xl w-full">
        <PageHeader
          eyebrow="Care"
          title="Prayer requests"
          actions={
            <Button asChild>
              <Link href="/prayer/new">
                <Plus size={16} />
                New request
              </Link>
            </Button>
          }
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const label = f === "all" ? "All" : PRAYER_STATUS_META[f as PrayerStatus].label
            return (
              <Link
                key={f}
                href={f === "all" ? "/prayer" : `/prayer?status=${f}`}
                className={cn(
                  "rounded-pill border px-3 py-1.5 text-small transition-colors",
                  active === f
                    ? "border-gold bg-gold text-white"
                    : "border-ink-hairline bg-white text-ink-muted hover:bg-surface",
                )}
              >
                {label}
              </Link>
            )
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-6 md:pb-8 max-w-4xl w-full">
        {!requests || requests.length === 0 ? (
          <EmptyState
            icon={<HeartHandshake size={24} />}
            title="No prayer requests"
            body={
              active === "all"
                ? "Log a request to start tracking how the team is praying for people."
                : "No requests with this status."
            }
          />
        ) : (
          <ul className="space-y-3">
            {requests.map((r) => {
              const meta = PRAYER_STATUS_META[r.status as PrayerStatus] ?? PRAYER_STATUS_META.new
              const who = r.contact?.name || r.requester_name || "Anonymous"
              return (
                <li
                  key={r.id}
                  className="rounded-lg border border-ink-hairline bg-white p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {r.contact ? (
                          <Link
                            href={`/contacts/${r.contact.id}`}
                            className="text-body text-ink font-medium hover:text-gold"
                          >
                            {who}
                          </Link>
                        ) : (
                          <span className="text-body text-ink font-medium">{who}</span>
                        )}
                        {r.contact?.phone && (
                          <span className="text-micro text-ink-faint font-mono">
                            {formatPhone(r.contact.phone)}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-body text-ink-muted whitespace-pre-wrap leading-normal">
                        {r.body}
                      </p>
                      <p className="mt-1 text-micro text-ink-faint" data-dynamic>
                        {format(new Date(r.created_at), "PP")}
                      </p>
                    </div>
                  </div>
                  <PrayerActions
                    id={r.id}
                    status={r.status as PrayerStatus}
                    contactName={r.contact?.name ?? r.requester_name ?? null}
                    canText={Boolean(r.contact_id && r.contact?.phone)}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
