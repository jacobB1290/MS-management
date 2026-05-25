import type { Metadata } from "next"
import Link from "next/link"
import { format } from "date-fns"
import { Plus, MessageCircleQuestion } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { formatPhone, cn } from "@/lib/utils"
import { InquiryActions } from "./inquiry-actions"
import { INQUIRY_STATUS_META, INQUIRY_STATUS_ORDER, type InquiryStatus } from "./status"

export const metadata: Metadata = { title: "Inquiries" }

const FILTERS = ["all", ...INQUIRY_STATUS_ORDER] as const

export default async function InquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await requireStaff()
  const { status } = await searchParams
  const active = (FILTERS as readonly string[]).includes(status ?? "") ? (status as string) : "all"

  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from("inquiries")
    .select("id, body, topic, status, requester_name, created_at, contact_id, contact:contacts(id, name, phone)")
    .order("created_at", { ascending: false })
    .limit(200)
  if (active !== "all") query = query.eq("status", active)
  const { data: inquiries } = await query

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-6 md:pt-8 pb-4 bg-bg max-w-4xl w-full">
        <PageHeader
          eyebrow="Front desk"
          title="Inquiries"
          actions={
            <Button asChild>
              <Link href="/inquiries/new">
                <Plus size={16} />
                New inquiry
              </Link>
            </Button>
          }
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const label = f === "all" ? "All" : INQUIRY_STATUS_META[f as InquiryStatus].label
            return (
              <Link
                key={f}
                href={f === "all" ? "/inquiries" : `/inquiries?status=${f}`}
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
        {!inquiries || inquiries.length === 0 ? (
          <EmptyState
            icon={<MessageCircleQuestion size={24} />}
            title="No inquiries"
            body={
              active === "all"
                ? "Log a question someone asked so the team can follow up and close the loop."
                : "No inquiries with this status."
            }
          />
        ) : (
          <ul className="space-y-3">
            {inquiries.map((r) => {
              const meta = INQUIRY_STATUS_META[r.status as InquiryStatus] ?? INQUIRY_STATUS_META.new
              const who = r.contact?.name || r.requester_name || "Anonymous"
              return (
                <li key={r.id} className="rounded-lg border border-ink-hairline bg-white p-5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    {r.topic && <span className="text-label text-gold-dark">{r.topic}</span>}
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
                  <InquiryActions
                    id={r.id}
                    status={r.status as InquiryStatus}
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
