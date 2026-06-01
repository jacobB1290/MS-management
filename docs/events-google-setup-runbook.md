# Events → Google Calendar setup runbook

The Events feature lets staff create events in the CRM that show up on
**ms.church**. The public site reads the church Google Calendar
(`morningstarchurchboise@gmail.com`) and renders whatever is on it, so the CRM
simply **writes to that same calendar** following the conventions the site
already understands (flyer as a Drive attachment, CTA as a `[CTA: text | url]`
tag in the description). No website change is needed.

This runbook is the provider-side (Google) config, separate from code. Until
it's done, the feature runs in **mock mode**: events save in the CRM and
"Publish" is logged but nothing is pushed to Google. Everything in the UI still
works so you can build and demo before connecting Google.

---

## Capability ladder (what each credential unlocks)

| Env set | Result |
|---|---|
| _nothing_ | Mock mode. Events save locally; Publish/Sync are no-ops (logged). |
| `GOOGLE_CALENDAR_API_KEY` only | **Read/Sync** only — pull events already on the calendar into the CRM. No publishing. |
| `GOOGLE_OAUTH_*` | **Full** — create/edit/cancel/delete events + upload & publicly share flyer images on Drive. |

You almost certainly want the OAuth path (publishing is the point).

---

## One-time Google setup (OAuth — the publishing path)

### 1. Google Cloud project + APIs
1. Go to <https://console.cloud.google.com/>, signed in as (or with access to)
   the church Google account that owns the calendar.
2. Create a project (e.g. `ms-church-crm`).
3. **Enable two APIs** (APIs & Services → Library): **Google Calendar API** and
   **Google Drive API**.

### 2. OAuth consent screen — PUBLISH TO PRODUCTION (load-bearing)
1. APIs & Services → OAuth consent screen → **External**.
2. Fill the basics (app name, support email = the church email, developer email).
3. Add scopes: `.../auth/calendar` and `.../auth/drive.file`.
4. **Set Publishing status to "In production"** (Audience → Publish app).

   > ⚠️ **This is the #1 gotcha.** While the app is in **"Testing"**, Google
   > issues refresh tokens that **expire after 7 days**, so the integration
   > would silently break every week. In **Production** the refresh token does
   > not expire under normal use. `calendar` is a "sensitive" scope, so an
   > **External + Production** app shows an "unverified app" interstitial during
   > the one-time connect — that's fine for a single staff mailbox: click
   > **Advanced → proceed**. Full Google verification is only needed if you ever
   > expose this OAuth to the public, which we don't. `drive.file` is
   > non-sensitive and stays out of the heavier "restricted" review entirely.

### 3. OAuth client
1. APIs & Services → Credentials → Create credentials → **OAuth client ID** →
   **Web application**.
2. Authorized redirect URI: use the OAuth Playground for the one-time token mint
   (next step): `https://developers.google.com/oauthplayground`.
3. Copy the **Client ID** and **Client secret**.

### 4. Mint the refresh token (do this AFTER publishing to Production)
Easiest path — Google's OAuth Playground:
1. Open <https://developers.google.com/oauthplayground>.
2. Gear icon (top right) → check **"Use your own OAuth credentials"** → paste the
   Client ID + secret from step 3.
3. In the left "Input your own scopes" box, enter both, space-separated:
   `https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file`
4. **Authorize APIs** → sign in as the **church** Google account → approve
   (click through the unverified-app screen if shown).
5. **Exchange authorization code for tokens** → copy the **Refresh token**.

   > The Playground request uses `access_type=offline` + `prompt=consent`, so a
   > refresh token is returned. If you re-do this later, you must re-consent
   > (`prompt=consent`) to get a fresh token.

### 5. Set Vercel env vars (and locally in `.env`)
```
GOOGLE_CALENDAR_ID=morningstarchurchboise@gmail.com   # the calendar ms.church reads
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REFRESH_TOKEN=1//0...                     # from step 4
# Optional: a Drive folder to keep flyers tidy (else they land in My Drive root)
GOOGLE_DRIVE_FOLDER_ID=
# Optional: a read-only API key, only if you want Sync to work without OAuth
GOOGLE_CALENDAR_API_KEY=
```
Redeploy. Settings → Provider configuration will show **Google Calendar —
publish events: ready**.

Because OAuth acts **as the church account that owns the calendar**, no calendar
sharing is needed, and flyer images are created in that account's own Drive
(15 GB free) and shared "anyone with the link" so the public site can load them.

---

## Keeping it alive

- **Monthly heartbeat.** A production refresh token still dies after ~6 months
  of *no use*. The CRM hits the Calendar API whenever staff publish/sync, which
  is normally enough; if events go quiet for months, open Events and tap **Sync**
  to keep the token warm.
- **Re-consent triggers.** The token also dies if the church revokes access in
  their Google account security settings, or changes the account password. If
  publishing starts failing with an auth error, re-run step 4 and update
  `GOOGLE_OAUTH_REFRESH_TOKEN`.

---

## How an event maps onto the calendar (for reference)

Owned by `src/server/google/eventMapping.ts`, verified against the site's own
parser by `npm run verify:events`:

| CRM field | Google Calendar | ms.church renders |
|---|---|---|
| Title | `summary` | image `alt` (the flyer is the visible content) |
| Start / end / all-day | `start`/`end` (`dateTime`+`America/Boise`, or all-day `date`) | date badge + time pill |
| Flyer image | a public **Drive attachment** (`supportsAttachments=true`) | the event image (`lh3.googleusercontent.com/d/<id>=w800`) |
| CTA (text + url) | `[CTA: text | https://url]` appended to `description` | button on the flyer (only for real http(s) links) |
| Description | `description` (CTA tag stripped) | not shown as text; feeds the link + alt |

> The public image URL form (`lh3.googleusercontent.com/d/<id>=w800`) is the same
> one the website already uses. It's reliable for hotlinking but is not an
> officially documented Google endpoint — the flyer is always shared
> `anyone:reader` first so it loads.

---

## Care notes

- **Don't make throwaway test events on the live calendar** — anything dated
  today or later appears on ms.church within ~5 minutes (the site caches the
  calendar for 5 min). Use mock mode (no creds) or a separate test calendar via
  `GOOGLE_CALENDAR_ID` while experimenting.
- **Two-way:** events created directly in Google Calendar are pulled into the
  CRM by **Sync**; events created in the CRM are pushed out on **Publish**. Both
  surfaces stay in step.
- Recurring events are imported as individual instances (the CRM edits a single
  event at a time); author complex recurrences in Google Calendar directly.
