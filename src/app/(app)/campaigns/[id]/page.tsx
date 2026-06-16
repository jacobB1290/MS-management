import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { format } from "date-fns"
import { MessageSquare, Mail } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import {
  resolveAudienceMode,
  summarizeAudience,
  fetchAudienceContacts,
  type AudienceBreakdown,
} from "@/server/comms/campaignAudience"
import { formatMoney } from "@/server/billing/twilio"
import { isVideoUrl } from "@/lib/media"
import { PageHeader } from "@/components/ui/page-header"
import { PageScaffold } from "@/components/ui/page-scaffold"
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
    skipped_no_consent: 0,
  }
  for (const r of recipients ?? []) {
    counts[r.status as keyof typeof counts] =
      (counts[r.status as keyof typeof counts] ?? 0) + 1
  }

  // Before sending, preview how the audience filter breaks down — who will be
  // messaged vs. skipped for no consent, opt-out, or no channel — so the start
  // confirmation isn't a blind blast. Uses the same classifier as the send
  // path, so the preview matches the result exactly.
  let audienceBreakdown: AudienceBreakdown | null = null
  if (campaign.status === "draft" || campaign.status === "scheduled") {
    const mode = resolveAudienceMode(
      campaign.audience_filter as Record<string, unknown> | null,
    )
    if (mode.mode !== "invalid") {
      // Same paged fetcher as the start route, so the preview counts can never
      // disagree with what staging will actually do (including past the
      // 1,000-row PostgREST response cap).
      const { rows: audienceRows } = await fetchAudienceContacts(supabase, mode)
      audienceBreakdown = summarizeAudience(
        campaign.channel as "sms" | "email",
        audienceRows,
      )
    }
  }

  const skippedFailed =
    counts.skipped_opt_out +
    counts.skipped_unsubscribed +
    counts.skipped_no_channel +
    counts.skipped_no_consent +
    counts.failed

  // Surface WHY a blast failed (the Brevo reason recorded by the worker) instead
  // of just a red badge — otherwise a rejected campaign reads as an unexplained
  // stall. See advanceBrevoEmailCampaign / recordProviderFailure.
  const failureDetail =
    campaign.status === "failed"
      ? ((campaign.brevo_sync as { detail?: string } | null)?.detail ?? null)
      : null

  return (
    <PageScaffold
      header={
        <PageHeader
          eyebrow="Campaign"
          title={campaign.name}
          backHref="/campaigns"
          backLabel="All campaigns"
          actions={<CampaignActions campaign={campaign} audienceBreakdown={audienceBreakdown} />}
          meta={
            <>
              <Badge variant={STATUS_VARIANT[campaign.status] ?? "muted"}>{campaign.status}</Badge>
              <span className="inline-flex items-center gap-1.5 text-small text-ink-muted">
                {campaign.channel === "sms" ? <MessageSquare size={14} /> : <Mail size={14} />}
                {campaign.channel.toUpperCase()}
              </span>
            </>
          }
        />
      }
    >
      <div className="space-y-8 pt-6">
        {failureDetail && (
          <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3">
            <p className="eyebrow text-danger">Send failed</p>
            <p className="mt-1 text-small text-ink-muted break-words">{failureDetail}</p>
          </div>
        )}
        {/* Metric band — flush serif numerals on the cream canvas */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 border-b border-ink-hairline pb-6 sm:grid-cols-4">
          <Stat label="Total" value={counts.total} />
          <Stat label="Sent / delivered" value={counts.sent + counts.delivered} />
          <Stat label="Queued" value={counts.queued + counts.sending} />
          <Stat label="Skipped / failed" value={skippedFailed} />
        </div>

        {counts.total > 0 && <DeliveryBar done={counts.sent + counts.delivered} total={counts.total} />}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <div className="rounded-lg border border-ink-hairline bg-white p-6">
              <p className="eyebrow mb-3">Message</p>
              {campaign.channel === "sms" ? (
                <div className="space-y-3">
                  {campaign.media_url &&
                    (isVideoUrl(campaign.media_url) ? (
                      <video src={campaign.media_url} controls className="max-h-72 w-auto rounded-md" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={campaign.media_url} alt="Attachment" className="max-h-72 w-auto rounded-md" />
                    ))}
                  {campaign.body ? (
                    <pre className="whitespace-pre-wrap font-body text-body leading-normal text-ink">
                      {campaign.body}
                    </pre>
                  ) : (
                    <p className="text-small text-ink-faint">Media only, no text</p>
                  )}
                </div>
              ) : (
                <dl className="space-y-2 text-small">
                  <div>
                    <dt className="text-label text-ink-faint">Template ID</dt>
                    <dd className="font-mono text-ink">{campaign.brevo_template_id}</dd>
                  </div>
                  <div>
                    <dt className="text-label text-ink-faint">Subject</dt>
                    <dd className="text-ink">{campaign.email_subject}</dd>
                  </div>
                </dl>
              )}
            </div>

            <div className="rounded-lg border border-ink-hairline bg-white p-6">
              <p className="eyebrow mb-3">Recipient breakdown</p>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-small">
                <Row label="Queued" value={counts.queued} />
                <Row label="Sending" value={counts.sending} />
                <Row label="Sent" value={counts.sent} />
                <Row label="Delivered" value={counts.delivered} />
                <Row label="Failed" value={counts.failed} highlight={counts.failed > 0 ? "danger" : undefined} />
                <Row label="Skipped (opt-out)" value={counts.skipped_opt_out} highlight={counts.skipped_opt_out > 0 ? "muted" : undefined} />
                <Row label="Skipped (no consent)" value={counts.skipped_no_consent} highlight={counts.skipped_no_consent > 0 ? "muted" : undefined} />
                <Row label="Skipped (unsubscribed)" value={counts.skipped_unsubscribed} highlight={counts.skipped_unsubscribed > 0 ? "muted" : undefined} />
                <Row label="Skipped (no channel)" value={counts.skipped_no_channel} highlight={counts.skipped_no_channel > 0 ? "muted" : undefined} />
              </dl>
            </div>
          </div>

          <div className="space-y-6">
            {campaign.channel === "sms" && (
              <div className="rounded-lg border border-ink-hairline bg-white p-6">
                <p className="eyebrow mb-3">Cost</p>
                <p className="font-display text-title leading-none text-ink" data-dynamic>
                  {formatMoney(cost.total, cost.currency)}
                </p>
                <p className="mt-2 text-small text-ink-muted" data-dynamic>
                  {costDetail}
                </p>
              </div>
            )}

            {campaign.channel === "email" && <EmailStats stats={campaign.stats} />}

            <div className="rounded-lg border border-ink-hairline bg-white p-6">
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
      </div>
    </PageScaffold>
  )
}

function DeliveryBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-micro text-ink-faint">
        <span className="uppercase tracking-wide">Delivery</span>
        <span data-dynamic>
          {done} of {total} sent
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-ink-hairline">
        <div
          className="h-full rounded-pill bg-gradient-to-r from-gold to-gold-dark transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-out-soft)] motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-label uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 font-display text-hero leading-none text-ink" data-dynamic>
        {value}
      </p>
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
      <dd className={`font-medium ${highlight === "danger" ? "text-danger" : "text-ink"}`}>{value}</dd>
    </div>
  )
}

/** Brevo campaign engagement (globalStats), cached on the campaign by the cron. */
function EmailStats({ stats }: { stats: unknown }) {
  const s = (stats ?? null) as {
    sent?: number
    delivered?: number
    viewed?: number
    uniqueViews?: number
    clickers?: number
    uniqueClicks?: number
    unsubscriptions?: number
    hardBounces?: number
    softBounces?: number
  } | null
  if (!s) return null
  const opens = s.uniqueViews ?? s.viewed ?? 0
  const clicks = s.uniqueClicks ?? s.clickers ?? 0
  const bounced = (s.hardBounces ?? 0) + (s.softBounces ?? 0)
  return (
    <div className="rounded-lg border border-ink-hairline bg-white p-6">
      <p className="eyebrow mb-3">Email engagement</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-small">
        <Row label="Sent" value={s.sent ?? 0} />
        <Row label="Delivered" value={s.delivered ?? 0} />
        <Row label="Opens" value={opens} />
        <Row label="Clicks" value={clicks} />
        <Row label="Unsubscribed" value={s.unsubscriptions ?? 0} />
        <Row label="Bounced" value={bounced} />
      </dl>
      <p className="mt-3 text-micro text-ink-faint">From Brevo. Refreshes as recipients engage.</p>
    </div>
  )
}
