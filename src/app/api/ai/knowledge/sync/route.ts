import { NextResponse } from "next/server"
import { requireAdmin } from "@/server/auth"
import { logAudit } from "@/server/audit"
import { syncChurchKnowledgeFromWebsite } from "@/server/ai/knowledgeSync"

// The sync fetches several pages from ms.church; give it room beyond the
// default serverless budget.
export const maxDuration = 60

/**
 * Admin-triggered "Sync from website" button. Pulls the latest content from
 * ms.church into the church knowledge base. Auth: requireAdmin.
 */
export async function POST() {
  const user = await requireAdmin()

  const summary = await syncChurchKnowledgeFromWebsite()

  await logAudit({
    action: "knowledge.sync",
    actorUserId: user.id,
    targetTable: "church_knowledge",
    diff: {
      ok: summary.ok,
      pages: summary.pages,
      inserted: summary.inserted,
      updated: summary.updated,
      deactivated: summary.deactivated,
      errors: summary.errors.length,
    },
  })

  return NextResponse.json({ ok: summary.ok, summary })
}
