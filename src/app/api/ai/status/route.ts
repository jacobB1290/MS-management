import { NextResponse } from "next/server"
import { requireStaff } from "@/server/auth"
import { isAiEnabled } from "@/server/ai/client"

/**
 * Lightweight capability probe so the operator UI can show or hide the
 * Claude-backed affordances without ever learning anything about the key.
 * Staff-gated; returns only a boolean.
 */
export async function GET() {
  await requireStaff()
  return NextResponse.json({ enabled: isAiEnabled() })
}
