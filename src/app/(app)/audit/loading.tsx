import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { BackButton } from "@/components/ui/back-button"
import { LoadingView, TableSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <DetailScaffold title="Audit log" backSlot={<BackButton label="Back" />} backMobileOnly>
      <LoadingView>
        <TableSkeleton className="mt-6" rows={10} />
      </LoadingView>
    </DetailScaffold>
  )
}
