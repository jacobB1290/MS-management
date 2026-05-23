import type { Metadata } from "next"
import { format } from "date-fns"
import { Check, X } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Avatar } from "@/components/ui/avatar"
import { TeamPanel } from "./team-panel"

export const metadata: Metadata = { title: "Settings" }

export default async function SettingsPage() {
  const user = await requireStaff()
  const supabase = await createSupabaseServerClient()

  const [teamRes, heartbeatRes] = await Promise.all([
    user.role === "admin"
      ? supabase.from("app_users").select("user_id, role, display_name, created_at").order("created_at")
      : Promise.resolve({ data: null }),
    supabase.from("heartbeat").select("last_run_at").eq("id", 1).maybeSingle(),
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

      {user.role === "admin" && (
        <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
          <p className="eyebrow mb-1">Team</p>
          <p className="text-small text-ink-muted mb-4">
            Sign-in is by invitation only. Admins can invite, demote, or remove
            people here. Removed people can still sign in but hit the no-access
            page.
          </p>
          <TeamPanel team={team ?? []} currentUserId={user.id} />
        </section>
      )}

      <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
        <p className="eyebrow mb-1">Provider configuration</p>
        <p className="text-small text-ink-muted mb-4">
          Set the provider env vars in Vercel and redeploy. Until a given
          provider is configured, the matching send path records the
          attempt without contacting the carrier — useful for staging,
          never for real delivery.
        </p>
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
        <p className="eyebrow mb-1">Heartbeat</p>
        <p className="text-small text-ink-muted mb-3">
          A daily ping keeps the free-tier Supabase project from pausing.
        </p>
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
