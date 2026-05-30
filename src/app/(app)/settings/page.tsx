import type { Metadata } from "next"
import { Suspense, type ReactNode } from "react"
import { format } from "date-fns"
import { Check, X } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { getSpendSummary, formatMoney } from "@/server/billing/twilio"
import {
  getAiSpendSummary,
  formatTokens,
} from "@/server/billing/anthropic"
import { getAiConfig } from "@/server/ai/config"
import { getModelFamilies } from "@/server/ai/models"
import { modelChoicesFrom } from "@/lib/ai-models"
import { listMmsMedia } from "@/server/media/storage"
import { PageHeader } from "@/components/ui/page-header"
import { BackButton } from "@/components/ui/back-button"
import { PageInfo } from "@/components/ui/page-info"
import { Badge } from "@/components/ui/badge"
import { Avatar } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { TeamPanel } from "./team-panel"
import { StoragePanel } from "./storage-panel"
import { NotificationsPanel } from "./notifications-panel"
import { AiModelsPanel } from "./ai-models-panel"
import { ChurchKnowledgePanel } from "./church-knowledge-panel"
import { getLastKnowledgeSync } from "@/server/ai/knowledgeSync"

export const metadata: Metadata = { title: "Settings" }

export default async function SettingsPage() {
  // Only the user (local, cached) is awaited up front, so the shell + the
  // instant sections (You, Notifications, Provider config) paint immediately.
  // Every data-backed section streams in its own Suspense boundary below —
  // the slow external calls (Twilio + Anthropic billing, the Models API,
  // storage listing) no longer block the page from appearing.
  const user = await requireStaff()
  const isAdmin = user.role === "admin"

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
      <div className="shrink-0 px-4 md:px-8 pt-4 md:pt-6 pb-4 bg-bg max-w-3xl w-full">
        <PageHeader eyebrow="Console" title="Settings" backSlot={<BackButton label="Back" />} />
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

        <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
          <p className="eyebrow mb-3">Notifications</p>
          <NotificationsPanel />
        </section>

        <Suspense fallback={<SectionSkeleton title="Spend" />}>
          <SpendSection />
        </Suspense>

        <Suspense fallback={<SectionSkeleton title="AI usage" />}>
          <AiUsageSection />
        </Suspense>

        {isAdmin && (
          <Suspense fallback={<SectionSkeleton title="AI models" />}>
            <AiModelsSection />
          </Suspense>
        )}

        <Suspense fallback={<SectionSkeleton title="Church knowledge" />}>
          <ChurchKnowledgeSection isAdmin={isAdmin} />
        </Suspense>

        <Suspense fallback={<SectionSkeleton title="Storage" />}>
          <StorageSection />
        </Suspense>

        {isAdmin && (
          <Suspense fallback={<SectionSkeleton title="Team" />}>
            <TeamSection currentUserId={user.id} />
          </Suspense>
        )}

        <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
          <SectionTitle
            label="About provider configuration"
            info="Set the provider env vars in Vercel and redeploy. Until a given provider is configured, the matching send path records the attempt without contacting the carrier; useful for staging, never for real delivery."
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
              detail={status.twilioMessaging ? "Configured" : "TWILIO_MESSAGING_SERVICE_SID missing; campaign batches won’t auto-meter"}
            />
            <StatusRow
              label="SendGrid API"
              ready={status.sendgrid}
              detail={status.sendgrid ? "Configured" : "SENDGRID_API_KEY + SENDGRID_FROM_EMAIL missing"}
            />
            <StatusRow
              label="SendGrid event webhook"
              ready={status.sendgridWebhook}
              detail={status.sendgridWebhook ? "Public key configured" : "SENDGRID_WEBHOOK_PUBLIC_KEY missing; events won’t be verified"}
            />
            <StatusRow
              label="Public form receiver"
              ready={status.publicForm}
              detail={status.publicForm ? "HMAC secret configured" : "PUBLIC_FORM_HMAC_SECRET missing"}
            />
            <StatusRow
              label="Cron secret"
              ready={status.cronSecret}
              detail={status.cronSecret ? "Cron endpoints protected" : "CRON_SECRET missing; anyone can hit the cron endpoint"}
            />
          </dl>
        </section>

        <Suspense fallback={<SectionSkeleton title="Heartbeat" />}>
          <HeartbeatSection />
        </Suspense>
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

/** Section-shaped placeholder shown while a streamed section's data loads. The
 *  card + title are real (no shift on those); only the body is a skeleton. */
function SectionSkeleton({ title }: { title: string }) {
  return (
    <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
      <p className="eyebrow mb-3">{title}</p>
      <div className="space-y-2.5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </section>
  )
}

async function SpendSection() {
  const spend = await getSpendSummary()
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

async function AiUsageSection() {
  const spend = await getAiSpendSummary()
  return (
    <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
      <SectionTitle
        label="About AI usage"
        info="Pulled live from Anthropic’s Cost and Usage APIs (cached 5 min). These are real billed amounts, never estimated, and cover all usage on the Anthropic organization. Anthropic exposes no prepaid balance via API, so none is shown."
      >
        AI usage
      </SectionTitle>

      {!spend.configured ? (
        <p className="text-small text-ink-faint">
          Set ANTHROPIC_ADMIN_KEY (an sk-ant-admin… Admin API key) to see live AI
          cost and usage.
        </p>
      ) : !spend.ok ? (
        <p className="text-small text-danger">
          Couldn&rsquo;t load Anthropic usage: {spend.error}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SpendStat label="This month" value={formatMoney(spend.thisMonth, spend.currency)} />
            <SpendStat label="Last month" value={formatMoney(spend.lastMonth, spend.currency)} />
          </div>

          {spend.models.length > 0 && (
            <dl className="mt-5 space-y-2 border-t border-ink-hairline pt-4 text-small">
              <p className="text-label text-ink-faint mb-1">This month by model</p>
              {spend.models.map((m) => (
                <div key={m.model} className="flex items-center justify-between gap-3">
                  <dt className="text-ink-muted min-w-0 truncate">
                    {m.label}
                    <span className="text-ink-faint">
                      {" "}
                      · {formatTokens(m.inputTokens)} in / {formatTokens(m.outputTokens)} out
                    </span>
                  </dt>
                  <dd className="font-medium text-ink shrink-0">
                    {formatMoney(m.cost, spend.currency)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </section>
  )
}

async function AiModelsSection() {
  const [config, modelFamilies] = await Promise.all([getAiConfig(), getModelFamilies()])
  const choices = modelChoicesFrom(modelFamilies)
  return (
    <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
      <SectionTitle
        label="About AI models"
        info="Pick which Claude model each feature uses, and how much reasoning effort to spend. Changes take effect immediately, no redeploy. Effort applies to Opus and Sonnet; Haiku ignores it. Prompts are cached to keep cost down regardless of model."
      >
        AI models
      </SectionTitle>
      <AiModelsPanel config={config} choices={choices} />
    </section>
  )
}

async function ChurchKnowledgeSection({ isAdmin }: { isAdmin: boolean }) {
  const supabase = await createSupabaseServerClient()
  const [knowledgeRes, lastSync] = await Promise.all([
    supabase
      .from("church_knowledge")
      .select("id, title, body, source, source_url, updated_at")
      .order("updated_at", { ascending: false }),
    getLastKnowledgeSync(),
  ])
  const knowledge = knowledgeRes.data ?? []
  const knowledgeSync = lastSync
    ? {
        ran_at: lastSync.ran_at,
        pages: lastSync.pages,
        inserted: lastSync.inserted,
        updated: lastSync.updated,
        ok: lastSync.ok,
      }
    : null
  return (
    <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
      <SectionTitle
        label="About church knowledge"
        info="Facts the AI draft assistant can look up when replying to people (service times, Bible studies, ministries, beliefs, how to visit). Synced daily from ms.church; you can also add entries by hand. The assistant decides when to use them and never invents details it can't find."
      >
        Church knowledge
      </SectionTitle>
      <ChurchKnowledgePanel entries={knowledge} lastSync={knowledgeSync} isAdmin={isAdmin} />
    </section>
  )
}

async function StorageSection() {
  const supabase = await createSupabaseServerClient()
  const [media, dbRpc] = await Promise.all([
    listMmsMedia(),
    supabase.rpc("database_size" as never),
  ])
  const dbBytes = Number((dbRpc.data as number | null) ?? 0)
  return (
    <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
      <SectionTitle
        label="About storage"
        info="Two separate Supabase free-tier limits: about 500 MB for your data (contacts, messages, campaigns) and 1 GB for media files. Deleting a media file frees file space but breaks its preview in any past message that used it."
      >
        Storage
      </SectionTitle>
      <StoragePanel files={media.files} totalBytes={media.totalBytes} dbBytes={dbBytes} />
    </section>
  )
}

async function TeamSection({ currentUserId }: { currentUserId: string }) {
  const supabase = await createSupabaseServerClient()
  const { data: team } = await supabase
    .from("app_users")
    .select("user_id, role, display_name, created_at")
    .order("created_at")
  return (
    <section className="mt-6 rounded-lg border border-ink-hairline bg-white p-6">
      <SectionTitle
        label="About team settings"
        info="Sign-in is by invitation only. Admins can invite, demote, or remove people here. Removed people can still sign in but hit the no-access page."
      >
        Team
      </SectionTitle>
      <TeamPanel team={team ?? []} currentUserId={currentUserId} />
    </section>
  )
}

async function HeartbeatSection() {
  const supabase = await createSupabaseServerClient()
  const { data: heartbeat } = await supabase
    .from("heartbeat")
    .select("last_run_at")
    .eq("id", 1)
    .maybeSingle()
  return (
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
