import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { ArrowLeft, MessageSquare, Mail } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { formatMoney } from "@/server/billing/twilio"
import { isVideoUrl } from "@/lib/media"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { CampaignActions } from "./campaign-actions"

export const metadata: Metadata = { title: "Campaign" }

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "danger" | "muted" | "gold"> = {
  draft: "muted",
  scheduled: "gold",
  sending: "gold",
  done: "success",
  failed: "danger",
  cancelled: "muted",
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CampaignDetail({ params }: PageProps) {
  await requireStaff()
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const [campaignRes, recipientsRes, messagesRes] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).maybeSingle(),
    supabase.from("campaign_recipients").select("status").eq("campaign_id", id),
    supabase
      .from("messages")
      .select("status, price, price_unit, twilio_sid")
      .eq("campaign_id", id)
      .eq("direction", "out"),
  ])
  const campaign = campaignRes.data
  const recipients = recipientsRes.data
  if (!campaign) notFound()

  // Actual cost, summed from the per-message prices Twilio settled. Never
  // estimated: a message with no price yet is "still settling", not guessed.
  const cost = { total: 0, settled: 0, pending: 0, mock: 0, currency: "USD" }
  for (const m of messagesRes.data ?? []) {
    if (m.twilio_sid?.startsWith("MOCK_")) {
      cost.mock += 1
    } else if (m.price != null) {
      cost.total += Math.abs(Number(m.price))
      cost.settled += 1
      if (m.price_unit) cost.currency = m.price_unit.toUpperCase()
    } else {
      cost.pending += 1
    }
  }
  const realMessages = cost.settled + cost.pending
  let costDetail: string
  if (realMessages === 0 && cost.mock === 0) {
    costDetail = "No messages sent yet."
  } else if (realMessages === 0) {
    costDetail = `${cost.mock} mock message${cost.mock === 1 ? "" : "s"}, no real charges.`
  } else {
    const parts = [`${cost.settled} of ${realMessages} settled`]
    if (cost.pending > 0) parts.push("costs settle within a few minutes of sending")
    if (cost.mock > 0) parts.push(`${cost.mock} mock`)
    costDetail = parts.join(" · ")
  }

  const counts = {
    total: recipients?.length ?? 0,
    queued: 0,
    sending: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    skipped_opt_out: 0,
    skipped_unsubscribed: 0,
    skipped_no_channel: 0,
  }
  for (const r of recipients ?? []) {
    counts[r.status as keyof typeof counts] =
      (counts[r.status as keyof typeof counts] ?? 0) + 1
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-6 md:pt-8 pb-4 bg-bg max-w-4xl w-full">
        <Link
          href="/campaigns"
          prefetch
          className="inline-flex items-center gap-1.5 text-small text-ink-muted active:text-ink mb-4 min-h-11"
        >
          <ArrowLeft size={14} /> All campaigns
        </Link>
        <PageHeader
          eyebrow="Campaign"
          title={campaign.name}
          actions={<CampaignActions campaign={campaign} />}
        />
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <Badge variant={STATUS_VARIANT[campaign.status] ?? "muted"}>
            {campaign.status}
          </Badge>
          <span className="inline-flex items-center gap-1.5 text-ink-muted text-small">
            {campaign.channel === "sms" ? <MessageSquare size={14} /> : <Mail size={14} />}
            {campaign.channel.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-6 md:pb-8 max-w-4xl w-full">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total" value={counts.total} />
        <Stat label="Sent / delivered" value={counts.sent + counts.delivered} />
        <Stat label="Queued" value={counts.queued + counts.sending} />
        <Stat label="Skipped / failed" value={counts.skipped_opt_out + counts.skipped_unsubscribed + counts.skipped_no_channel + counts.failed} />
      </div>

      {campaign.channel === "sms" && (
        <div className="mt-8 rounded-lg border border-ink-hairline bg-white p-6">
          <p className="eyebrow mb-3">Cost</p>
          <p className="font-display text-title text-ink leading-none" data-dynamic>
            {formatMoney(cost.total, cost.currency)}
          </p>
          <p className="mt-2 text-small text-ink-muted" data-dynamic>
            {costDetail}
          </p>
        </div>
      )}

      <div className="mt-8 rounded-lg border border-ink-hairline bg-white p-6">
        <p className="eyebrow mb-3">Message</p>
        {campaign.channel === "sms" ? (
          <div className="space-y-3">
            {campaign.media_url &&
              (isVideoUrl(campaign.media_url) ? (
                <video src={campaign.media_url} controls className="rounded-md max-h-72 w-auto" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={campaign.media_url} alt="Attachment" className="rounded-md max-h-72 w-auto" />
              ))}
            {campaign.body ? (
              <pre className="whitespace-pre-wrap font-body text-body text-ink leading-normal">
                {campaign.body}
              </pre>
            ) : (
              <p className="text-small text-ink-faint">Media only — no text.</p>
            )}
          </div>
        ) : (
          <dl className="space-y-2 text-small">
            <div>
              <dt className="text-label text-ink-faint">Template ID</dt>
              <dd className="font-mono text-ink">{campaign.sendgrid_template_id}</dd>
            </div>
            <div>
              <dt className="text-label text-ink-faint">Subject</dt>
              <dd className="text-ink">{campaign.email_subject}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
        <p className="eyebrow mb-3">Recipient breakdown</p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-small">
          <Row label="Queued" value={counts.queued} />
          <Row label="Sending" value={counts.sending} />
          <Row label="Sent" value={counts.sent} />
          <Row label="Delivered" value={counts.delivered} />
          <Row label="Failed" value={counts.failed} highlight={counts.failed > 0 ? "danger" : undefined} />
          <Row label="Skipped — opt-out" value={counts.skipped_opt_out} highlight={counts.skipped_opt_out > 0 ? "muted" : undefined} />
          <Row label="Skipped — unsubscribed" value={counts.skipped_unsubscribed} highlight={counts.skipped_unsubscribed > 0 ? "muted" : undefined} />
          <Row label="Skipped — no channel" value={counts.skipped_no_channel} highlight={counts.skipped_no_channel > 0 ? "muted" : undefined} />
        </dl>
      </div>

      <div className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
        <p className="eyebrow mb-3">Timeline</p>
        <dl className="space-y-2 text-small">
          <Row label="Created" value={format(new Date(campaign.created_at), "PPp")} />
          {campaign.scheduled_at && (
            <Row label="Scheduled" value={format(new Date(campaign.scheduled_at), "PPp")} />
          )}
          {campaign.started_at && (
            <Row label="Started" value={format(new Date(campaign.started_at), "PPp")} />
          )}
          {campaign.completed_at && (
            <Row label="Completed" value={format(new Date(campaign.completed_at), "PPp")} />
          )}
        </dl>
      </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-ink-hairline bg-white p-4">
      <p className="text-label text-ink-faint">{label}</p>
      <p className="font-display text-title text-ink mt-0.5 leading-none">{value}</p>
    </div>
  )
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string
  value: number | string
  highlight?: "danger" | "muted"
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-faint">{label}</dt>
      <dd
        className={`font-medium ${
          highlight === "danger" ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
