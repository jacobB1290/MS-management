#!/usr/bin/env node
// Mint a Google OAuth **refresh token** via the loopback flow (no deps, Node 18+).
//
// Designed for an AI agent to drive: the agent runs this, the script prints an
// auth URL, a HUMAN opens it and approves (the one step an agent can't do —
// signing into the church's Google account), and the script captures the code
// and prints the refresh token. See docs/oauth-setup-runbook.md.
//
// Usage:
//   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy \
//   SCOPES="https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file" \
//   node scripts/mint-google-token.mjs
//
// or:
//   node scripts/mint-google-token.mjs --client-id xxx --client-secret yyy --scopes "scope1 scope2"
//
// REQUIRED in Google Cloud Console: add this redirect URI to the OAuth client:
//   http://localhost:53682/        (override the port with PORT=NNNNN)

import http from "node:http"

const PORT = Number(process.env.PORT || 53682)
const REDIRECT = `http://localhost:${PORT}/`

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const clientId = process.env.GOOGLE_CLIENT_ID || arg("client-id")
const clientSecret = process.env.GOOGLE_CLIENT_SECRET || arg("client-secret")
const scopes = process.env.SCOPES || arg("scopes")

if (!clientId || !clientSecret || !scopes) {
  console.error(
    "Missing input. Provide GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and SCOPES " +
      "(env vars or --client-id / --client-secret / --scopes).",
  )
  process.exit(1)
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: scopes,
    access_type: "offline", // required to receive a refresh_token
    prompt: "consent", // force a fresh consent so a refresh_token is always returned
    include_granted_scopes: "true",
  }).toString()

console.log("\n────────────────────────────────────────────────────────")
console.log("STEP 1 (HUMAN): open this URL, sign in as the TARGET Google")
console.log("account, and click Allow. (If it warns 'unverified app' for a")
console.log("sensitive scope, choose Advanced -> proceed.)\n")
console.log(authUrl)
console.log(`\nSTEP 2: waiting for the redirect on ${REDIRECT} ...`)
console.log("────────────────────────────────────────────────────────\n")

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT)
  const code = url.searchParams.get("code")
  const err = url.searchParams.get("error")

  if (!code && !err) {
    res.statusCode = 204
    res.end()
    return
  }

  if (err) {
    res.end(`OAuth error: ${err}. Return to the terminal.`)
    console.error(`\nOAuth error: ${err}`)
    server.close()
    process.exit(1)
  }

  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT,
        grant_type: "authorization_code",
      }),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(JSON.stringify(j))

    res.end("Success. Close this tab and return to the terminal.")
    if (j.refresh_token) {
      console.log("\n=== REFRESH TOKEN (store securely — never commit / log to chat) ===\n")
      console.log(j.refresh_token)
      console.log("\nScopes granted:", j.scope, "\n")
    } else {
      console.log(
        "\nNo refresh_token returned. This happens when the account already " +
          "granted consent before. Re-run (prompt=consent forces a new one), or " +
          "revoke the app at https://myaccount.google.com/permissions and retry.\n",
      )
    }
  } catch (e) {
    res.end(`Token exchange failed: ${e.message}`)
    console.error("\nToken exchange failed:", e.message)
  } finally {
    server.close()
    setTimeout(() => process.exit(0), 100)
  }
})

server.listen(PORT, () => {})
