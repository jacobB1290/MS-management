/**
 * Build a Playwright storageState carrying a REAL Supabase session, so the
 * perf harness can measure authenticated pages on a live deployment (and on
 * localhost) without driving the OTP login UI.
 *
 * Auth: signs in with E2E_EMAIL / E2E_PASSWORD (a temporary, dedicated test
 * staff user — never a real person's account) via the password grant, then
 * serializes the session into the exact cookie format @supabase/ssr expects,
 * including the 3180-char chunking rule.
 *
 * Usage:
 *   E2E_EMAIL=... E2E_PASSWORD=... tsx scripts/perf/login-state.ts <hostname> [more hostnames]
 * Writes scripts/perf/.auth-state.json (gitignored).
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://nhrgbjkiiqpzwdgsvdrl.supabase.co"
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""
const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0]

// Mirrors @supabase/ssr's chunker: values longer than this are split into
// `<name>.0`, `<name>.1`, … cookies that createServerClient reassembles.
const MAX_CHUNK_SIZE = 3180

function chunkCookie(name: string, value: string): Array<{ name: string; value: string }> {
  if (value.length <= MAX_CHUNK_SIZE) return [{ name, value }]
  const chunks: Array<{ name: string; value: string }> = []
  for (let i = 0; i * MAX_CHUNK_SIZE < value.length; i++) {
    chunks.push({
      name: `${name}.${i}`,
      value: value.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE),
    })
  }
  return chunks
}

async function main() {
  const email = process.env.E2E_EMAIL
  const password = process.env.E2E_PASSWORD
  if (!email || !password || !SUPABASE_KEY) {
    console.error("E2E_EMAIL, E2E_PASSWORD and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required")
    process.exit(1)
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    console.error(`Sign-in failed (${res.status}):`, await res.text())
    process.exit(1)
  }
  const session = await res.json()

  // @supabase/ssr stores the session JSON base64url-encoded with a "base64-"
  // prefix in a cookie named sb-<ref>-auth-token.
  const encoded =
    "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url")
  const chunks = chunkCookie(`sb-${projectRef}-auth-token`, encoded)

  const hosts = process.argv.slice(2)
  if (hosts.length === 0) hosts.push("localhost")

  const cookies = hosts.flatMap((host) =>
    chunks.map((c) => ({
      name: c.name,
      value: c.value,
      domain: host,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 3000,
      httpOnly: false,
      secure: host !== "localhost",
      sameSite: "Lax" as const,
    })),
  )

  const out = join(dirname(new URL(import.meta.url).pathname), ".auth-state.json")
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({ cookies, origins: [] }, null, 2))
  console.log(`Wrote ${out} (${chunks.length} cookie chunk(s) × ${hosts.length} host(s))`)
}

main()
