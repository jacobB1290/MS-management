import Link from "next/link"
import { Plus } from "lucide-react"
import { PageMasthead } from "@/components/ui/page-masthead"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { LoadingView, TableSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <PageScaffold
      header={
        <PageMasthead
          title="Campaigns"
          description="One-off SMS and email announcements to a chosen audience."
          actions={
            <Link href="/campaigns/new" aria-label="New campaign" className="btn-icon-action">
              <Plus size={20} strokeWidth={2.5} />
            </Link>
          }
        />
      }
    >
      <LoadingView>
        <TableSkeleton className="mt-6" />
      </LoadingView>
    </PageScaffold>
  )
}
