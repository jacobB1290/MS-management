# OAuth setup runbook (for an AI agent)

This is the single, master runbook for obtaining every **Google OAuth refresh
token** the system needs. It's written so an AI agent can drive it end to end,
with a human doing only the one thing an agent cannot: signing into the church's
Google account and clicking **Allow**.

> **What "OAuth things" means here:** long-lived **refresh tokens** for the
> church Google identities, stored as server-side env vars. They are what let the
> system act on the church's behalf (write the calendar, upload flyers, read
> YouTube captions, mirror Gmail) **without anyone being logged in** — the server
> exchanges a refresh token for a short-lived access token on each run.

Feature-specific detail lives in the sibling runbooks; this one ties them
together and is the entry point:
- `docs/events-google-setup-runbook.md` — Calendar + Drive (events)
- `docs/sermons-youtube-setup-runbook.md` — YouTube captions (sermons)
- `docs/brevo-email-setup-runbook.md` — email sending (Brevo; not OAuth) + Gmail mirror context

---

## 0. What you're producing

| Token (env vars) | Identity to sign in as | Scopes | Powers |
|---|---|---|---|
| `GOOGLE_OAUTH_REFRESH_TOKEN` (+ `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`) | the church Google account that owns the **Calendar** (`morningstarchurchboise@gmail.com`) — and the **YouTube channel** too, if it's the same account | `calendar` + `drive.file` (+ `youtube.force-ssl` if this account also owns the channel) | Events publish/sync, flyer uploads, **and** sermon captions |
| `GOOGLE_YOUTUBE_REFRESH_TOKEN` (+ `GOOGLE_YOUTUBE_CLIENT_ID` / `_SECRET`) | the account that owns the **YouTube channel** `@morningstarboise` — **only if it's NOT the calendar account** | `youtube.force-ssl` | Sermon captions only |
| `GOOGLE_GMAIL_REFRESH_TOKEN` (+ `GOOGLE_GMAIL_CLIENT_ID` / `_SECRET`) | the **support mailbox** `support@ms.church` (Google Workspace) | `gmail.readonly` (+ `gmail.send` for Phase 2) | Two-way email: mirror replies into the CRM (+ optionally send 1:1 through Gmail) |

**Key idea:** one OAuth *app* (one Client ID/Secret) can mint *all* of these.
The token differs only by **which account you sign in as** and **which scopes**
you request. So the agent needs: **1 OAuth client + up to 3 refresh tokens.**
(The code falls back `GOOGLE_GMAIL_CLIENT_*` → `GOOGLE_OAUTH_CLIENT_*` and
`GOOGLE_YOUTUBE_CLIENT_*` → `GOOGLE_OAUTH_CLIENT_*`, so you can reuse one
client's id/secret for every token and only set the three refresh tokens.)

---

## 1. Roles: who must be a human

| Step | Agent | Human |
|---|---|---|
| Decide accounts/scopes (§2) | ✅ ask the operator | answers |
| Google Cloud Console config (§3) | ⚠️ only if it has console access; otherwise hand the human the exact clicks | does the clicks |
| Open auth URL + click **Allow** (§4) | ❌ cannot (account password + 2FA) | ✅ **required** |
| Run the mint script, capture the token (§4) | ✅ | — |
| Set env vars on Vercel + Supabase (§5) | ✅ if it has Vercel/Supabase access | otherwise pastes them in |
| Verify (§6) | ✅ | — |

The **only** hard human step is opening the consent URL and approving. Everything
else an agent can do if it has the relevant access.

---

## 2. Decide the accounts (ask the operator these two questions)

1. **Does `morningstarchurchboise@gmail.com` own the YouTube channel
   `@morningstarboise`?**
   - **Yes** → one token covers Calendar + Drive + YouTube. You will NOT set the
     `GOOGLE_YOUTUBE_*` vars.
   - **No** → you'll mint a second token signed in as the channel's account and
     set `GOOGLE_YOUTUBE_*`.
2. **Is `support@ms.church` a separate Google Workspace mailbox?** (Almost
   certainly yes.) → it gets its own token (`GOOGLE_GMAIL_*`), minted while
   signed in as `support@ms.church`.

Write the answers down; they decide how many times you run §4.

---

## 3. Google Cloud Console — one-time app setup

Do this once in <https://console.cloud.google.com/> (one project is fine).

1. **Enable the APIs** (APIs & Services → Library → Enable): **Google Calendar
   API**, **Google Drive API**, **YouTube Data API v3**, **Gmail API**. Enable
   only the ones you're using, but enabling all four now avoids a return trip.
2. **OAuth consent screen** → User type **External**.
   - Add the scopes you'll use (see the table in §0).
   - **Publish to Production** (Audience → Publish app). ⚠️ **Load-bearing:** in
     **Testing**, Google issues refresh tokens that **expire after 7 days** —
     the integrations would silently break weekly. In **Production** they don't
     expire under normal use. `youtube.force-ssl` and the Gmail scopes are
     **sensitive**, so an External+Production app shows an "unverified app"
     screen on the one-time consent — that's expected for a single owner/staff
     mailbox: **Advanced → proceed**. Full Google verification is only needed to
     publish the app to the public, which we don't.
3. **Create the OAuth client**: Credentials → Create credentials → **OAuth client
   ID → Web application**. Copy the **Client ID** and **Client secret**.
   - Under **Authorized redirect URIs**, add BOTH so either mint method works:
     - `http://localhost:53682/` ← for the script in §4 (Method A)
     - `https://developers.google.com/oauthplayground` ← for the Playground (Method B)

---

## 4. Mint the refresh token(s)

Run this **once per token** from §2 (1–3 times), each time signed in as that
token's account, requesting that token's scopes.

**Scope strings** (space-separated):
- Calendar + Drive: `https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file`
- add YouTube (same account): append ` https://www.googleapis.com/auth/youtube.force-ssl`
- YouTube only (separate account): `https://www.googleapis.com/auth/youtube.force-ssl`
- Gmail (read): `https://www.googleapis.com/auth/gmail.readonly`
- Gmail (read + Phase-2 send): `https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send`

### Method A — script (recommended for an agent)

```bash
GOOGLE_CLIENT_ID="<client id>" \
GOOGLE_CLIENT_SECRET="<client secret>" \
SCOPES="https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file" \
node scripts/mint-google-token.mjs
```

The script prints an auth URL and waits. **A human opens that URL, signs in as
the target account, and clicks Allow.** The script captures the redirect,
exchanges the code, and prints the **refresh token**. Repeat with the YouTube /
Gmail scopes (and the right account) for the other tokens.

> If it prints "No refresh_token returned," the account already consented before
> — revoke at <https://myaccount.google.com/permissions> and re-run (the script
> already sends `prompt=consent`).

### Method B — OAuth Playground (fallback, all-clicks)

<https://developers.google.com/oauthplayground> → gear icon → check **Use your
own OAuth credentials** → paste Client ID + secret → in "Input your own scopes"
paste the scope string → **Authorize APIs** (sign in as the target account) →
**Exchange authorization code for tokens** → copy the **Refresh token**.

---

## 5. Where each value goes

Set on the **Vercel project (Production scope)** for `ms-management`, and mirror
into a local `.env` for dev. Never commit real values.

```bash
# One OAuth app, reused for every token:
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...

# Token 1 — calendar + drive (+ youtube if same account):
GOOGLE_OAUTH_REFRESH_TOKEN=1//0...

# Token 2 — ONLY if the YouTube channel is a different account:
GOOGLE_YOUTUBE_CLIENT_ID=        # leave blank to reuse GOOGLE_OAUTH_CLIENT_ID
GOOGLE_YOUTUBE_CLIENT_SECRET=    # leave blank to reuse GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_YOUTUBE_REFRESH_TOKEN=1//0...

# Token 3 — Gmail (support@ms.church). Client id/secret fall back to GOOGLE_OAUTH_* if blank:
GOOGLE_GMAIL_CLIENT_ID=
GOOGLE_GMAIL_CLIENT_SECRET=
GOOGLE_GMAIL_REFRESH_TOKEN=1//0...
GOOGLE_GMAIL_ADDRESS=support@ms.church
# GOOGLE_GMAIL_SEND=1            # Phase 2 only: route 1:1 sending through Gmail

# Already-present, not OAuth (leave as configured):
# GOOGLE_CALENDAR_ID=morningstarchurchboise@gmail.com
# GOOGLE_CALENDAR_API_KEY=...    # public-calendar reads
# YOUTUBE_PLAYLIST_ID=PLHs3usNpG0bZHnAJlIpwBtkbnd7xDCeRC
```

Agent with Vercel CLI access can do, per var:
`vercel env add GOOGLE_OAUTH_REFRESH_TOKEN production` (paste value when prompted), then `vercel --prod` to redeploy.

> **Sermon pipeline also needs** `CRON_SECRET` (Vercel) + the Supabase Vault
> secrets `app_base_url` and `cron_secret` (see `sermons-youtube-setup-runbook.md`
> / migration `0037`). Those are not OAuth, but the weekly run won't fire without
> them.

> **On the website (`ms.church`)**, the only related var is
> `CRM_SERMONS_ENDPOINT=https://<crm-host>/api/public/sermons` so `/watch` can
> render published sermons. No OAuth on the website side.

---

## 6. Verify

- **Calendar + Drive:** in the CRM, create an event and **Publish** → it appears
  on the church Google Calendar (and on ms.church within ~5 min). `npm run
  verify:events` checks the calendar mapping contract.
- **YouTube captions / sermons:** CRM **Sermons → Run now** → detect → transcribe
  → segment should all go green and land a sermon at **review**. Publish it →
  it shows on `https://ms.church/watch`.
- **Gmail mirror:** send a 1:1 email from the inbox; a reply to it (in
  `support@ms.church`) should appear back in the CRM thread on the next sync.

If a step fails with an auth error, re-mint that token (§4) — the most common
cause is a token minted while the app was still in **Testing** (7-day expiry).

---

## 7. Gotchas + keep-alive

- **Production, not Testing** — the #1 failure (7-day token death). Verify the
  consent screen says "In production."
- **Sensitive-scope interstitial** — expected on the one-time consent for
  `youtube.force-ssl` / Gmail; Advanced → proceed.
- **Keep-alive** — a Production refresh token doesn't expire under normal use,
  but dies after ~6 months of total inactivity, or if the account changes its
  password / revokes access. The weekly sermon cron + ongoing event/Gmail use
  keep them warm.
- **One account per token** — you must be signed in as the *owning* account when
  approving (captions only download for the channel owner; Gmail only reads its
  own mailbox).

---

## 8. Security (important for an agent)

- A refresh token is a **long-lived credential**. Treat it like a password.
- **Never** commit it, paste it into chat, or print it into shared logs. Put it
  straight into Vercel/Supabase secret storage.
- Prefer setting it via `vercel env add` (stdin) over echoing it on a command
  line that lands in shell history.
- If a token is ever exposed, revoke at <https://myaccount.google.com/permissions>
  and re-mint.
