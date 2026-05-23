import type { Metadata } from "next"
import { requireStaff } from "@/server/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/ui/page-header"
import { CampaignComposer } from "./campaign-composer"

export const metadata: Metadata = { title: "New campaign" }

export default async function NewCampaignPage() {
  await requireStaff()
  const supabase = await createSupabaseServerClient()
  const { data: contactRows } = await supabase
    .from("contacts")
    .select("tags")
    .limit(5000)

  const tagCounts = new Map<string, number>()
  for (const row of contactRows ?? []) {
    for (const t of row.tags ?? []) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
    }
  }
  const tagOptions = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }))

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-6 md:pt-8 pb-4 bg-bg max-w-3xl w-full">
        <PageHeader
          eyebrow="Outreach"
          title="New campaign"
          info="Compose a one-off SMS or email blast. Opted-out and unsubscribed contacts are automatically excluded — the recipient list records who was skipped and why."
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-6 md:pb-8 max-w-3xl w-full">
        <div className="rounded-lg border border-ink-hairline bg-white p-6 md:p-8">
          <CampaignComposer tagOptions={tagOptions} />
        </div>
      </div>
    </div>
  )
}
