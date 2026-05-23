import type { Metadata } from "next"
import type { ReactNode } from "react"
import { format } from "date-fns"
import { Check, X } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { getSpendSummary, formatMoney, type SpendSummary } from "@/server/billing/twilio"
import { listMmsMedia } from "@/server/media/storage"
import { PageHeader } from "@/components/ui/page-header"
import { PageInfo } from "@/components/ui/page-info"
import { Badge } from "@/components/ui/badge"
import { Avatar } from "@/components/ui/avatar"
import { TeamPanel } from "./team-panel"
import { StoragePanel } from "./storage-panel"

export const metadata: Metadata = { title: "Settings" }

export default async function SettingsPage() {
  const user = await requireStaff()
  const supabase = await createSupabaseServerClient()

  const [teamRes, heartbeatRes, spend, media] = await Promise.all([
    user.role === "admin"
      ? supabase.from("app_users").select("user_id, role, display_name, created_at").order("created_at")
      : Promise.resolve({ data: null }),
    supabase.from("heartbeat").select("last_run_at").eq("id", 1).maybeSingle(),
    getSpendSummary(),
    listMmsMedia(),
  ])
  const team = teamRes.data
  const heartbeat = heartbeatRes.data

  const status = {
    twilio: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    twilioMessaging: Boolean(process.env.TWILIO_MESSAGING_SERVICE_SID),
    sendgrid: Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL),
    sendgridWebhook: Boolean(process.env.SENDGRID_WEBHOOK_PUBLIC_KEY),
    publicForm: Boolean(process.env.PUBLIC_FORM_HMAC_SECRET),
    cronSecret: Boolean(process.env.CRON_SECRET),
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-6 md:pt-8 pb-4 bg-bg max-w-3xl w-full">
        <PageHeader eyebrow="Console" title="Settings" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-6 md:pb-8 max-w-3xl w-full">
      <section className="rounded-lg border border-ink-hairline bg-white p-6">
        <p className="eyebrow mb-3">You</p>
        <div className="flex items-center gap-4">
          <Avatar name={user.displayName ?? user.email} size="lg" />
          <div>
            <p className="font-medium text-ink">{user.displayName ?? user.email}</p>
            <p className="text-small text-ink-faint">{user.email}</p>
            <Badge variant="gold" className="mt-2 capitalize">
              {user.role}
            </Badge>
          </div>
        </div>
      </section>

      <SpendSection spend={spend} />

      <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
        <SectionTitle
          label="About storage"
          info="MMS attachments you send are stored here. Supabase's free tier gives 1 GB of file storage, separate from your contacts and messages. Delete old media to free space — note that removing a file breaks its preview in any past message that used it."
        >
          Storage
        </SectionTitle>
        <StoragePanel files={media.files} totalBytes={media.totalBytes} />
      </section>

      {user.role === "admin" && (
        <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
          <SectionTitle
            label="About team settings"
            info="Sign-in is by invitation only. Admins can invite, demote, or remove people here. Removed people can still sign in but hit the no-access page."
          >
            Team
          </SectionTitle>
          <TeamPanel team={team ?? []} currentUserId={user.id} />
        </section>
      )}

      <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
        <SectionTitle
          label="About provider configuration"
          info="Set the provider env vars in Vercel and redeploy. Until a given provider is configured, the matching send path records the attempt without contacting the carrier — useful for staging, never for real delivery."
        >
          Provider configuration
        </SectionTitle>
        <dl className="space-y-2">
          <StatusRow
            label="Twilio (account + auth)"
            ready={status.twilio}
            detail={status.twilio ? "Configured" : "TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN missing"}
          />
          <StatusRow
            label="Twilio Messaging Service"
            ready={status.twilioMessaging}
            detail={status.twilioMessaging ? "Configured" : "TWILIO_MESSAGING_SERVICE_SID missing — campaign batches won't auto-meter"}
          />
          <StatusRow
            label="SendGrid API"
            ready={status.sendgrid}
            detail={status.sendgrid ? "Configured" : "SENDGRID_API_KEY + SENDGRID_FROM_EMAIL missing"}
          />
          <StatusRow
            label="SendGrid event webhook"
            ready={status.sendgridWebhook}
            detail={status.sendgridWebhook ? "Public key configured" : "SENDGRID_WEBHOOK_PUBLIC_KEY missing — events won't be verified"}
          />
          <StatusRow
            label="Public form receiver"
            ready={status.publicForm}
            detail={status.publicForm ? "HMAC secret configured" : "PUBLIC_FORM_HMAC_SECRET missing"}
          />
          <StatusRow
            label="Cron secret"
            ready={status.cronSecret}
            detail={status.cronSecret ? "Cron endpoints protected" : "CRON_SECRET missing — anyone can hit the cron endpoint"}
          />
        </dl>
      </section>

      <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
        <SectionTitle
          label="About the heartbeat"
          info="A daily ping keeps the free-tier Supabase project from pausing."
        >
          Heartbeat
        </SectionTitle>
        <p className="text-body" data-dynamic>
          {heartbeat?.last_run_at
            ? `Last run: ${format(new Date(heartbeat.last_run_at), "PPp")}`
            : "Never run."}
        </p>
      </section>
      </div>
    </div>
  )
}

function SectionTitle({
  children,
  info,
  label,
}: {
  children: ReactNode
  info: ReactNode
  label: string
}) {
  return (
    <div className="flex items-center gap-1 mb-3">
      <p className="eyebrow">{children}</p>
      <PageInfo label={label}>{info}</PageInfo>
    </div>
  )
}

function SpendSection({ spend }: { spend: SpendSummary }) {
  return (
    <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
      <SectionTitle
        label="About spend"
        info="Pulled live from Twilio (cached 5 min). These are the same numbers on the invoice, never estimated, and cover all Twilio usage on this account."
      >
        Spend
      </SectionTitle>

      {!spend.configured ? (
        <p className="text-small text-ink-faint">
          Connect Twilio (set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN) to see
          live spend.
        </p>
      ) : !spend.ok ? (
        <p className="text-small text-danger">
          Couldn&rsquo;t load Twilio usage: {spend.error}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SpendStat
              label="Balance"
              value={spend.balance != null ? formatMoney(spend.balance, spend.currency) : "—"}
            />
            <SpendStat label="This month" value={formatMoney(spend.thisMonth, spend.currency)} />
            <SpendStat label="Last month" value={formatMoney(spend.lastMonth, spend.currency)} />
          </div>

          <dl className="mt-5 space-y-2 border-t border-ink-hairline pt-4 text-small">
            <p className="text-label text-ink-faint mb-1">This month by category</p>
            {spend.breakdown.map((row) => (
              <div key={row.category} className="flex items-center justify-between">
                <dt className="text-ink-muted">
                  {row.label}
                  <span className="text-ink-faint"> · {row.count}</span>
                </dt>
                <dd className="font-medium text-ink">{formatMoney(row.price, spend.currency)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}

function SpendStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-ink-hairline bg-surface p-4">
      <p className="text-label text-ink-faint">{label}</p>
      <p className="font-display text-heading text-ink mt-0.5 leading-none" data-dynamic>
        {value}
      </p>
    </div>
  )
}

function StatusRow({
  label,
  ready,
  detail,
}: {
  label: string
  ready: boolean
  detail: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="flex items-start gap-2">
        {ready ? (
          <Check size={16} className="text-success shrink-0 mt-0.5" />
        ) : (
          <X size={16} className="text-ink-faint shrink-0 mt-0.5" />
        )}
        <div>
          <p className="text-body text-ink">{label}</p>
          <p className="text-small text-ink-faint">{detail}</p>
        </div>
      </div>
      <Badge variant={ready ? "success" : "muted"}>
        {ready ? "ready" : "pending"}
      </Badge>
    </div>
  )
}
