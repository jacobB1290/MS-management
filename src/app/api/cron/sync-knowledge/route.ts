import { NextResponse, type NextRequest } from "next/server"
import { syncChurchKnowledgeFromWebsite } from "@/server/ai/knowledgeSync"

// Fetches several pages from ms.church; give it room beyond the default budget.
export const maxDuration = 60

/**
 * Daily knowledge sync from ms.church, run by the GitHub Actions cron
 * (`.github/workflows/knowledge-sync.yml`). Keeps the AI's church facts current
 * without anyone clicking the Settings button.
 *
 * Auth: Bearer token via `CRON_SECRET`. Fail-closed when it isn't set.
 */
export async function GET(request: NextRequest) {
  const provided = request.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return new NextResponse("Cron not configured", { status: 503 })
  }
  if (provided !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const summary = await syncChurchKnowledgeFromWebsite()
  return NextResponse.json({ ok: summary.ok, summary })
}
