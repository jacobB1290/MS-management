import { PageHeader } from "@/components/ui/page-header"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { BackButton } from "@/components/ui/back-button"
import { LoadingView, TableSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <PageScaffold
      header={
        <PageHeader
          title="Audit log"
          backSlot={<BackButton label="Back" />}
          backMobileOnly
        />
      }
    >
      <LoadingView>
        <TableSkeleton className="mt-6" rows={10} />
      </LoadingView>
    </PageScaffold>
  )
}
