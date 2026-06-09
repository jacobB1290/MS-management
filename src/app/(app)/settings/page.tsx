import type { Metadata } from "next"
import { Suspense, type ReactNode } from "react"
import { format } from "date-fns"
import { Check, X } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { getSpendSummary, formatMoney } from "@/server/billing/twilio"
import { getAiSpendSummary, formatTokens } from "@/server/billing/anthropic"
import { getAiConfig } from "@/server/ai/config"
import { getModelFamilies } from "@/server/ai/models"
import { modelChoicesFrom } from "@/lib/ai-models"
import { listMmsMedia } from "@/server/media/storage"
import { getLastKnowledgeSync } from "@/server/ai/knowledgeSync"
import { PageHeader } from "@/components/ui/page-header"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { BackButton } from "@/components/ui/back-button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { TeamPanel } from "./team-panel"
import { StoragePanel } from "./storage-panel"
import { NotificationsPanel } from "./notifications-panel"
import { AiModelsPanel } from "./ai-models-panel"
import { ChurchKnowledgePanel } from "./church-knowledge-panel"
import { SettingsShell, type SettingsSection } from "./settings-shell"

export const metadata: Metadata = { title: "Settings" }

export default async function SettingsPage() {
  // Only the user (local, cached) is awaited up front, so the shell + its
  // instant panes (Account, Notifications, System) paint immediately. Every
  // data-backed pane streams in its own Suspense boundary, exactly as before —
  // the slow external calls (Twilio + Anthropic billing, the Models API,
  // storage listing) never block the page from appearing.
  const user = await requireStaff()
  const isAdmin = user.role === "admin"

  const googleWrite = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  )
  const status = {
    twilio: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    twilioMessaging: Boolean(process.env.TWILIO_MESSAGING_SERVICE_SID),
    brevo: Boolean(process.env.BREVO_API_KEY),
    brevoWebhook: Boolean(process.env.BREVO_WEBHOOK_TOKEN),
    googleWrite,
    googleRead: googleWrite || Boolean(process.env.GOOGLE_CALENDAR_API_KEY),
    publicForm: Boolean(process.env.PUBLIC_FORM_HMAC_SECRET),
    cronSecret: Boolean(process.env.CRON_SECRET),
  }

  // Build the panes the shell navigates. Order is the rail order; admin-only
  // panes are simply absent for members (the shell renders whatever it's given).
  const sections: SettingsSection[] = [
    {
      id: "account",
      content: (
        <Card>
          <div className="flex items-center gap-4">
            <Avatar name={user.displayName ?? user.email} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">
                {user.displayName ?? user.email}
              </p>
              <p className="truncate text-small text-ink-faint">{user.email}</p>
              <Badge variant="gold" className="mt-2 capitalize">
                {user.role}
              </Badge>
            </div>
          </div>
        </Card>
      ),
    },
    {
      id: "notifications",
      content: (
        <Card>
          <NotificationsPanel />
        </Card>
      ),
    },
    ...(isAdmin
      ? [
          {
            id: "ai-models" as const,
            content: (
              <Suspense fallback={<CardSkeleton lines={6} />}>
                <AiModelsCard />
              </Suspense>
            ),
          },
        ]
      : []),
    {
      id: "knowledge",
      content: (
        <Suspense fallback={<CardSkeleton lines={4} />}>
          <ChurchKnowledgeCard isAdmin={isAdmin} />
        </Suspense>
      ),
    },
    {
      id: "usage",
      content: (
        <>
          <Suspense fallback={<CardSkeleton title="Messaging spend" lines={3} />}>
            <SpendCard />
          </Suspense>
          <Suspense fallback={<CardSkeleton title="AI usage" lines={2} />}>
            <AiUsageCard />
          </Suspense>
        </>
      ),
    },
    {
      id: "storage",
      content: (
        <Suspense fallback={<CardSkeleton lines={3} />}>
          <StorageCard />
        </Suspense>
      ),
    },
    ...(isAdmin
      ? [
          {
            id: "team" as const,
            content: (
              <Suspense fallback={<CardSkeleton lines={3} />}>
                <TeamCard currentUserId={user.id} />
              </Suspense>
            ),
          },
        ]
      : []),
    {
      id: "system",
      content: (
        <>
          <Card>
            <CardLede
              title="Provider configuration"
              blurb="Set the provider env vars in Vercel and redeploy. Until a provider is configured, its send path records the attempt without contacting the carrier — useful for staging, never for real delivery."
            />
            <dl className="space-y-1">
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
                label="Brevo API"
                ready={status.brevo}
                detail={status.brevo ? "Configured" : "BREVO_API_KEY missing; email runs in mock mode"}
              />
              <StatusRow
                label="Brevo webhook"
                ready={status.brevoWebhook}
                detail={status.brevoWebhook ? "Token configured" : "BREVO_WEBHOOK_TOKEN missing; unsubscribes won’t sync"}
              />
              <StatusRow
                label="Google Calendar — publish events"
                ready={status.googleWrite}
                detail={
                  status.googleWrite
                    ? "OAuth connected; events + flyers publish to ms.church"
                    : "GOOGLE_OAUTH_* missing; events save as drafts and aren’t pushed live"
                }
              />
              <StatusRow
                label="Google Calendar — read / sync"
                ready={status.googleRead}
                detail={
                  status.googleRead
                    ? "Can pull events created directly in Google Calendar"
                    : "Set GOOGLE_OAUTH_* or GOOGLE_CALENDAR_API_KEY to sync"
                }
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
          </Card>
          <Suspense fallback={<CardSkeleton title="Heartbeat" lines={1} />}>
            <HeartbeatCard />
          </Suspense>
        </>
      ),
    },
  ]

  return (
    <PageScaffold
      header={
        <PageHeader
          eyebrow="Console"
          title="Settings"
          backSlot={<BackButton label="Back" />}
          backMobileOnly
        />
      }
    >
      <SettingsShell sections={sections} />
    </PageScaffold>
  )
}

/** Small titled header for the cards inside a multi-card pane (Usage, System),
 *  one step below the pane title so the hierarchy reads page → pane → card. */
function CardLede({ title, blurb }: { title: string; blurb?: string }) {
  return (
    <div className="mb-[var(--space-md)]">
      <h3 className="text-body font-semibold text-ink">{title}</h3>
      {blurb && (
        <p className="mt-0.5 text-small leading-[var(--leading-prose)] text-ink-muted">
          {blurb}
        </p>
      )}
    </div>
  )
}

/** Card-shaped placeholder while a streamed pane's data loads. */
function CardSkeleton({ title, lines = 3 }: { title?: string; lines?: number }) {
  return (
    <Card>
      {title && <CardLede title={title} />}
      <div className="space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={i % 2 === 0 ? "h-4 w-2/3" : "h-4 w-1/2"} />
        ))}
      </div>
    </Card>
  )
}

async function SpendCard() {
  const spend = await getSpendSummary()
  return (
    <Card>
      <CardLede
        title="Messaging spend"
        blurb="Live from Twilio, cached 5 minutes — the same figures on your invoice, never estimated."
      />
      {!spend.configured ? (
        <p className="text-small text-ink-faint">
          Connect Twilio (set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN) to see live spend.
        </p>
      ) : !spend.ok ? (
        <p className="text-small text-danger">Couldn&rsquo;t load Twilio usage: {spend.error}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
    </Card>
  )
}

async function AiUsageCard() {
  const spend = await getAiSpendSummary()
  return (
    <Card>
      <CardLede
        title="AI usage"
        blurb="Real billed amounts from Anthropic’s Cost and Usage APIs, cached 5 minutes. No prepaid balance is exposed via API, so none is shown."
      />
      {!spend.configured ? (
        <p className="text-small text-ink-faint">
          Set ANTHROPIC_ADMIN_KEY (an sk-ant-admin… Admin API key) to see live AI cost and usage.
        </p>
      ) : !spend.ok ? (
        <p className="text-small text-danger">Couldn&rsquo;t load Anthropic usage: {spend.error}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
    </Card>
  )
}

async function AiModelsCard() {
  const [config, modelFamilies] = await Promise.all([getAiConfig(), getModelFamilies()])
  const choices = modelChoicesFrom(modelFamilies)
  return (
    <Card>
      <AiModelsPanel config={config} choices={choices} />
    </Card>
  )
}

async function ChurchKnowledgeCard({ isAdmin }: { isAdmin: boolean }) {
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
    <Card>
      <ChurchKnowledgePanel entries={knowledge} lastSync={knowledgeSync} isAdmin={isAdmin} />
    </Card>
  )
}

async function StorageCard() {
  const supabase = await createSupabaseServerClient()
  const [media, dbRpc] = await Promise.all([
    listMmsMedia(),
    supabase.rpc("database_size" as never),
  ])
  const dbBytes = Number((dbRpc.data as number | null) ?? 0)
  return (
    <Card>
      <StoragePanel files={media.files} totalBytes={media.totalBytes} dbBytes={dbBytes} />
    </Card>
  )
}

async function TeamCard({ currentUserId }: { currentUserId: string }) {
  const supabase = await createSupabaseServerClient()
  const { data: team } = await supabase
    .from("app_users")
    .select("user_id, role, display_name, created_at")
    .order("created_at")
  return (
    <Card>
      <TeamPanel team={team ?? []} currentUserId={currentUserId} />
    </Card>
  )
}

async function HeartbeatCard() {
  const supabase = await createSupabaseServerClient()
  const { data: heartbeat } = await supabase
    .from("heartbeat")
    .select("last_run_at")
    .eq("id", 1)
    .maybeSingle()
  return (
    <Card>
      <CardLede title="Heartbeat" blurb="A daily ping keeps the free-tier database from pausing." />
      <p className="text-body" data-dynamic>
        {heartbeat?.last_run_at
          ? `Last run: ${format(new Date(heartbeat.last_run_at), "PPp")}`
          : "Never run."}
      </p>
    </Card>
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
}): ReactNode {
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
      <Badge variant={ready ? "success" : "muted"}>{ready ? "ready" : "pending"}</Badge>
    </div>
  )
}
