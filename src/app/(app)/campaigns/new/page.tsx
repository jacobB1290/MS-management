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
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-3xl">
      <PageHeader eyebrow="Outreach" title="New campaign" />
      <p className="mt-2 text-ink-muted text-body leading-normal">
        Compose a one-off SMS or email blast. Opted-out and unsubscribed
        contacts are automatically excluded — the recipient list records who
        was skipped and why.
      </p>

      <div className="mt-8 rounded-lg border border-ink-hairline bg-white p-6 md:p-8">
        <CampaignComposer tagOptions={tagOptions} />
      </div>
    </div>
  )
}
