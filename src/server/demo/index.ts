import "server-only"
import { cookies } from "next/headers"

/**
 * Demo mode. Gated by the deploy-level env flag DEMO_MODE — when it is not "1"
 * (i.e. production), every code path here is inert: the flag short-circuits
 * before any cookie is read, so the demo bypass cannot be triggered.
 *
 * On a demo deployment there is no real database, so the data layer returns the
 * in-memory client based purely on the flag; the cookie below only gates AUTH
 * (whether the visitor has "signed into" the demo by typing `demo`).
 */
export const DEMO_COOKIE = "ms_demo"

export function isDemoEnabled(): boolean {
  return process.env.DEMO_MODE === "1"
}

/** True only when demo is enabled AND the visitor has entered the demo. */
export async function hasDemoSession(): Promise<boolean> {
  if (!isDemoEnabled()) return false
  const store = await cookies()
  return store.get(DEMO_COOKIE)?.value === "1"
}

export { DEMO_USER } from "./fixtures"
export { createDemoClient } from "./client"
