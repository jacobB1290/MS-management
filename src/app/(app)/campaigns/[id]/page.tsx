import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { format } from "date-fns"
import { MessageSquare, Mail, Users } from "lucide-react"
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
import { formatPhone, cn } from "@/lib/utils"
import { recipientOutcome, type OutcomeGroup } from "@/lib/campaign-recipient-status"
import { withContactFrom } from "@/lib/contact-nav"
import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { Badge } from "@/components/ui/badge"
import { SectionHeading } from "@/components/ui/section-heading"
import { EmptyState } from "@/components/ui/empty-state"
import { CampaignActions } from "./campaign-actions"
import { DeliveryFunnel } from "./delivery-funnel"
import { RecipientTable, type RecipientRow } from "./recipient-table"

export const metadata: Metadata = { title: "Campaign" }

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "danger" | "muted" | "gold"> = {
  draft: "muted",
  scheduled: "gold",
  sending: "gold",
  done: "success",
  failed: "danger",
  cancelled: "muted",
}

const GROUP_RANK: Record<OutcomeGroup, number> = { failed: 0, skipped: 1, inflight: 2, delivered: 3 }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CampaignDetail({ params }: PageProps) {
  await requireStaff()
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const [campaignRes, recipientsRes, messagesRes] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("campaign_recipients")
      .select("contact_id, status, error, sent_at", { count: "exact" })
      .eq("campaign_id", id)
      .range(0, 999),
    supabase
      .from("messages")
      .select("contact_id, status, error, price, price_unit, twilio_sid")
      .eq("campaign_id", id)
      .eq("direction", "out"),
  ])
  const campaign = campaignRes.data
  if (!campaign) notFound()
  const channel = campaign.channel as "sms" | "email"
  const recipients = recipientsRes.data ?? []
  const totalRecipients = recipientsRes.count ?? recipients.length

  // Names for the recipient rows. Separate fetch (not a PostgREST embed) because
  // campaign_recipients' FK resolves to both `contacts` and `contact_summary`,
  // which makes the embed ambiguous; an `in(...)` over the loaded ids is simpler
  // and fully typed.
  const contactIds = recipients.map((r) => r.contact_id)
  const contactRows =
    contactIds.length > 0
      ? (await supabase.from("contacts").select("id, name, phone, email").in("id", contactIds)).data ?? []
      : []
  const contactById = new Map(contactRows.map((c) => [c.id, c]))

  // SMS only: the carrier-confirmed delivery status + real error live on the
  // outbound message (set by the delivery webhook), keyed by contact. This same
  // fetch also feeds the cost summary below — no extra round-trip.
  const carrierByContact = new Map<string, { status: string | null; error: string | null }>()
  if (channel === "sms") {
    for (const m of messagesRes.data ?? []) {
      if (m.contact_id) carrierByContact.set(m.contact_id, { status: m.status, error: m.error })
    }
  }

  // Email only: per-recipient delivery events (bounce / spam / unsubscribe) from
  // the Brevo webhook, keyed by email — they override the optimistic "sent" so a
  // bounced address doesn't read as delivered. Matched to THIS campaign by the
  // camp_id the event payload carries. (Requires the Brevo marketing webhook to
  // be configured; without it there's no per-recipient delivery feed.)
  const emailEventByEmail = new Map<string, string>()
  if (channel === "email" && campaign.brevo_campaign_id) {
    const recipientEmails = contactRows
      .map((c) => c.email?.toLowerCase())
      .filter((e): e is string => Boolean(e))
    if (recipientEmails.length > 0) {
      const { data: events } = await supabase
        .from("email_events")
        .select("email, event_type, payload")
        .in("email", recipientEmails)
        .in("event_type", ["hard_bounce", "spam", "unsubscribe"])
      const severity: Record<string, number> = { hard_bounce: 3, spam: 2, unsubscribe: 1 }
      for (const ev of events ?? []) {
        const camp = (ev.payload as { camp_id?: number } | null)?.camp_id
        if (camp != null && String(camp) !== String(campaign.brevo_campaign_id)) continue
        const email = ev.email?.toLowerCase()
        if (!email) continue
        const cur = emailEventByEmail.get(email)
        if (!cur || (severity[ev.event_type] ?? 0) > (severity[cur] ?? 0)) {
          emailEventByEmail.set(email, ev.event_type)
        }
      }
    }
  }

  // Actual cost, summed from per-message prices Twilio settled. Never estimated.
  const cost = { total: 0, settled: 0, pending: 0, mock: 0, currency: "USD" }
  for (const m of messagesRes.data ?? []) {
    if (m.twilio_sid?.startsWith("MOCK_")) cost.mock += 1
    else if (m.price != null) {
      cost.total += Math.abs(Number(m.price))
      cost.settled += 1
      if (m.price_unit) cost.currency = m.price_unit.toUpperCase()
    } else cost.pending += 1
  }
  const realMessages = cost.settled + cost.pending
  let costDetail: string
  if (realMessages === 0 && cost.mock === 0) costDetail = "No messages sent yet."
  else if (realMessages === 0) costDetail = `${cost.mock} mock message${cost.mock === 1 ? "" : "s"}, no real charges.`
  else {
    const parts = [`${cost.settled} of ${realMessages} settled`]
    if (cost.pending > 0) parts.push("costs settle within a few minutes of sending")
    if (cost.mock > 0) parts.push(`${cost.mock} mock`)
    costDetail = parts.join(" · ")
  }

  // Build per-recipient rows (who + why) and tally the funnel buckets.
  const groupCounts = { delivered: 0, inflight: 0, skipped: 0, failed: 0 }
  const enriched = recipients.map((r) => {
    const c = contactById.get(r.contact_id)
    const name =
      c?.name?.trim() || (c?.phone ? formatPhone(c.phone) : null) || c?.email || "Unknown contact"
    const handle =
      channel === "sms"
        ? c?.phone
          ? formatPhone(c.phone)
          : "No phone"
        : c?.email || "No email"
    const carrier = channel === "sms" ? carrierByContact.get(r.contact_id) : undefined
    const emailEvent =
      channel === "email" && c?.email ? emailEventByEmail.get(c.email.toLowerCase()) ?? null : null
    const outcome = recipientOutcome(channel, r.status, r.error, carrier?.status, carrier?.error, emailEvent)
    groupCounts[outcome.group] += 1
    const row: RecipientRow = {
      contactId: r.contact_id,
      name,
      handle,
      label: outcome.label,
      chip: outcome.group === "failed" ? "Failed" : outcome.label,
      detail: outcome.detail,
      variant: outcome.variant,
      group: outcome.group,
      when: r.sent_at ? format(new Date(r.sent_at), "MMM d, p") : null,
      href: hrefFor(channel, outcome.label, outcome.group, r.contact_id, id),
    }
    return { row, group: outcome.group, sentAt: r.sent_at }
  })
  // Attention-first (failed → skipped → in-flight → delivered), newest within.
  enriched.sort(
    (a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || (b.sentAt ?? "").localeCompare(a.sentAt ?? ""),
  )
  const rows = enriched.map((e) => e.row)
  const loadedTotal = rows.length

  const sentYet = recipients.length > 0
  const reached = groupCounts.delivered

  // Pre-send: preview who the audience filter will reach, using the same
  // classifier the send path uses, so the numbers match exactly.
  let audienceBreakdown: AudienceBreakdown | null = null
  if (!sentYet && (campaign.status === "draft" || campaign.status === "scheduled")) {
    const mode = resolveAudienceMode(campaign.audience_filter as Record<string, unknown> | null)
    if (mode.mode !== "invalid") {
      const { rows: audienceRows } = await fetchAudienceContacts(supabase, mode)
      audienceBreakdown = summarizeAudience(channel, audienceRows)
    }
  }
  const previewSkipped = audienceBreakdown
    ? audienceBreakdown.skipped_no_consent +
      audienceBreakdown.skipped_opt_out +
      audienceBreakdown.skipped_unsubscribed +
      audienceBreakdown.skipped_no_channel
    : 0

  // Surface WHY a blast failed wholesale (the Brevo reason the worker recorded).
  const failureDetail =
    campaign.status === "failed"
      ? ((campaign.brevo_sync as { detail?: string } | null)?.detail ?? null)
      : null

  // Built once, fed to both the desktop PageHeader and the mobile collapsing
  // header by DetailScaffold.
  const actions = <CampaignActions campaign={campaign} audienceBreakdown={audienceBreakdown} />
  const meta = (
    <>
      <Badge variant={STATUS_VARIANT[campaign.status] ?? "muted"}>{campaign.status}</Badge>
      <span className="inline-flex items-center gap-1.5 text-small text-ink-muted">
        {channel === "sms" ? <MessageSquare size={14} /> : <Mail size={14} />}
        {channel.toUpperCase()}
      </span>
    </>
  )

  return (
    <DetailScaffold
      eyebrow="Campaign"
      title={campaign.name}
      backHref="/campaigns"
      backLabel="All campaigns"
      actions={actions}
      meta={meta}
    >
      <div className="space-y-[var(--space-xl)] pt-6">
        {failureDetail && (
          <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3">
            <p className="eyebrow text-danger">Send failed</p>
            <p className="mt-1 text-small text-ink-muted break-words">{failureDetail}</p>
          </div>
        )}

        {/* Region A + B — one headline number, then the delivery funnel */}
        <div className="space-y-[var(--space-md)]">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-hero leading-none text-ink" data-dynamic>
              {sentYet ? reached : (audienceBreakdown?.queued ?? 0)}
            </span>
            <span className="text-body text-ink-muted">
              {sentYet
                ? `of ${totalRecipients} ${totalRecipients === 1 ? "person" : "people"} reached`
                : `of ${audienceBreakdown?.total ?? 0} ${
                    (audienceBreakdown?.total ?? 0) === 1 ? "contact" : "contacts"
                  } will be reached`}
            </span>
          </div>
          <DeliveryFunnel
            delivered={sentYet ? groupCounts.delivered : 0}
            inflight={sentYet ? groupCounts.inflight : (audienceBreakdown?.queued ?? 0)}
            skipped={sentYet ? groupCounts.skipped : previewSkipped}
            failed={sentYet ? groupCounts.failed : 0}
            total={sentYet ? loadedTotal : (audienceBreakdown?.total ?? 0)}
          />
        </div>

        {/* The recipient roster is the star — full width, attention-first. */}
        <section>
          <SectionHeading>Recipients</SectionHeading>
          {sentYet ? (
            <RecipientTable rows={rows} loadedOf={totalRecipients > loadedTotal ? totalRecipients : null} />
          ) : (
            <EmptyState
              icon={<Users size={28} />}
              title="No recipients yet"
              body="Start the send to stage every contact here. You'll see exactly who was reached, and who was skipped and why."
            />
          )}
        </section>

        {/* Reference bands sit below the roster, flush on the cream canvas. */}
        <div className="grid gap-[var(--space-xl)] md:grid-cols-2 lg:grid-cols-3">
          <section>
            <SectionHeading>Message</SectionHeading>
            {channel === "sms" ? (
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
              <div className="space-y-1">
                <p className="text-body text-ink">
                  {campaign.email_subject || <span className="text-ink-faint">No subject</span>}
                </p>
                <p className="text-micro font-mono text-ink-faint">
                  Brevo template #{campaign.brevo_template_id}
                </p>
              </div>
            )}
          </section>

          {channel === "sms" ? (
            <section>
              <SectionHeading>Cost</SectionHeading>
              <p className="font-display text-lead leading-none text-ink" data-dynamic>
                {formatMoney(cost.total, cost.currency)}
              </p>
              <p className="mt-2 text-small text-ink-muted" data-dynamic>
                {costDetail}
              </p>
            </section>
          ) : (
            <EmailStats stats={campaign.stats} />
          )}

          <section>
            <SectionHeading>Timeline</SectionHeading>
            <Timeline
              items={[
                { label: "Created", at: campaign.created_at },
                campaign.scheduled_at ? { label: "Scheduled", at: campaign.scheduled_at } : null,
                campaign.started_at ? { label: "Started", at: campaign.started_at } : null,
                campaign.completed_at ? { label: "Completed", at: campaign.completed_at } : null,
              ].filter((x): x is { label: string; at: string } => x !== null)}
            />
          </section>
        </div>
      </div>
    </DetailScaffold>
  )
}

function hrefFor(
  channel: "sms" | "email",
  label: string,
  group: OutcomeGroup,
  contactId: string,
  campaignId: string,
): string {
  // Record the campaign as the origin so the contact page's back button returns
  // here, not to the contacts directory.
  const from = `campaign:${campaignId}`
  if (label === "No phone" || label === "No email")
    return withContactFrom(`/contacts/${contactId}/edit`, from)
  if (group === "delivered" && channel === "sms") return `/inbox?c=${contactId}`
  return withContactFrom(`/contacts/${contactId}`, from)
}

function Timeline({ items }: { items: { label: string; at: string }[] }) {
  return (
    <ol>
      {items.map((it, i) => {
        const last = i === items.length - 1
        return (
          <li key={it.label} className="flex gap-3">
            <span className="flex flex-col items-center">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden />
              {!last && <span className="w-px flex-1 bg-ink-hairline" aria-hidden />}
            </span>
            <div className={cn(last ? "" : "pb-4")}>
              <p className="text-small text-ink">{it.label}</p>
              <p className="text-micro text-ink-faint" data-dynamic>
                {format(new Date(it.at), "PPp")}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
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
    <section>
      <SectionHeading>Engagement</SectionHeading>
      <dl className="grid grid-cols-3 gap-x-4 gap-y-5">
        <MiniStat label="Sent" value={s.sent ?? 0} />
        <MiniStat label="Delivered" value={s.delivered ?? 0} />
        <MiniStat label="Opens" value={opens} emphasize />
        <MiniStat label="Clicks" value={clicks} emphasize />
        <MiniStat label="Unsub" value={s.unsubscriptions ?? 0} />
        <MiniStat label="Bounced" value={bounced} />
      </dl>
      <p className="mt-3 text-micro text-ink-faint">From Brevo. Refreshes as recipients engage.</p>
    </section>
  )
}

function MiniStat({ label, value, emphasize }: { label: string; value: number; emphasize?: boolean }) {
  return (
    <div>
      <dd
        className={cn("font-display text-lead leading-none", emphasize ? "text-ink" : "text-ink-muted")}
        data-dynamic
      >
        {value}
      </dd>
      <dt className="mt-1 text-micro uppercase tracking-[var(--tracking-wide)] text-ink-faint">{label}</dt>
    </div>
  )
}
