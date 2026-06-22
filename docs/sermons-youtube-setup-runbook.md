# Sermons → YouTube captions setup runbook

The Sermons feature turns each Sunday's YouTube video into an SEO asset. Weekly
the CRM:

1. **detects** the newest service video (public YouTube RSS feed, no key),
2. **transcribes** it by downloading the video's YouTube captions,
3. **segments** the transcript with Claude into chapters (sermon, worship,
   scripture, prayer, announcements) with titles, summaries, and scripture refs,
4. leaves the result at status **review** in the CRM "Sermons" tab, where a human
   **publishes** it — which makes it appear on **ms.church** (chaptered
   transcript + `VideoObject` schema) via the public feed.

Everything except one credential is already in place (Supabase, Vercel, the
Claude key, the cron). This runbook covers that **one credential**: a Google
OAuth refresh token that can read the channel's captions.

---

## Capability ladder (what each credential unlocks)

| Env set | Result |
|---|---|
| _nothing_ | Detect works; **transcribe fails** with `no_access`. The weekly run records a single FAILED row in the Sermons monitor (expected) and the sermon stays at `detected`. |
| YouTube OAuth refresh token (this runbook) | **Transcribe works.** Full pipeline runs to `review`. |
| + `ANTHROPIC_API_KEY` (already set) | **Segment works** too — the chaptered transcript is produced. |

So the only thing standing between "mock-fail" and "fully working" is the
caption OAuth token below.

---

## Why captions need OAuth (and the ownership rule)

YouTube's `captions.download` API only returns a caption track **to the owner of
the video**. So the pipeline authenticates **as the Google account that owns the
YouTube channel** (`@morningstarboise`). There is no API key shortcut and no
reliable public scrape — owner OAuth is the correct, durable path.

The scope required is **`https://www.googleapis.com/auth/youtube.force-ssl`**.
That is the one scope the existing Google setup (calendar + drive.file) does
**not** have.

### Two paths — pick based on one question

> **Is the YouTube channel `@morningstarboise` owned by the SAME Google account
> as the calendar (`morningstarchurchboise@gmail.com`)?**

- **YES (most likely)** → **easiest path.** Just add the `youtube.force-ssl`
  scope to the OAuth client you already made for Events and re-mint the refresh
  token. Replace `GOOGLE_OAUTH_REFRESH_TOKEN` with the new one (it will now carry
  all three scopes: calendar + drive.file + youtube.force-ssl). Set **nothing
  else** — the captions client falls back to `GOOGLE_OAUTH_*` automatically.
- **NO (channel is a different Google account)** → give the pipeline its **own**
  client + token under that account, and set the dedicated
  `GOOGLE_YOUTUBE_*` vars. The rest of Google keeps using `GOOGLE_OAUTH_*`.

Both paths are the same steps below; only *which account you sign in as* and
*which env vars you paste into* differ.

---

## One-time setup

### 1. Enable the API
In <https://console.cloud.google.com/> (the same project as Events, or a new one
under the channel's account), **APIs & Services → Library → enable "YouTube Data
API v3"**.

### 2. OAuth consent screen — add the scope, PUBLISH TO PRODUCTION
1. APIs & Services → OAuth consent screen.
2. Add the scope **`.../auth/youtube.force-ssl`** (alongside calendar +
   drive.file if this is the shared Events client).
3. **Publishing status must be "In production."** (Audience → Publish app.)

   > ⚠️ **Same #1 gotcha as Events.** In **"Testing"**, Google issues refresh
   > tokens that **expire after 7 days** — the pipeline would break every week.
   > In **Production** the token doesn't expire under normal use. `youtube.force-ssl`
   > is a **sensitive** scope, so an External + Production app shows an
   > "unverified app" interstitial on the one-time connect — fine for a single
   > staff/owner mailbox: **Advanced → proceed**. Full Google verification is only
   > needed to expose the OAuth publicly, which we don't.

### 3. OAuth client
- **Shared-account path:** reuse the existing Events **Web application** OAuth
  client (Client ID + secret). Nothing new to create.
- **Separate-account path:** APIs & Services → Credentials → Create credentials →
  **OAuth client ID → Web application**. Copy the Client ID + secret.

### 4. Mint the refresh token (AFTER publishing to Production)
Use Google's OAuth Playground:
1. Open <https://developers.google.com/oauthplayground>.
2. Gear icon (top-right) → check **"Use your own OAuth credentials"** → paste the
   Client ID + secret.
3. Left "Input your own scopes" box — enter the scope(s):
   - shared-account path (re-mint all three so the one token covers everything):
     `https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/youtube.force-ssl`
   - separate-account path (captions only):
     `https://www.googleapis.com/auth/youtube.force-ssl`
4. **Authorize APIs** → sign in **as the account that owns the YouTube channel**
   → approve (click through the unverified-app screen if shown).
5. **Exchange authorization code for tokens** → copy the **Refresh token**.

   > The Playground sends `access_type=offline` + `prompt=consent`, so a refresh
   > token is returned. Re-doing this later requires re-consent to get a fresh one.

### 5. Set the env vars (Vercel PRODUCTION scope + local `.env`)

**Shared-account path** — just replace the existing token:
```
GOOGLE_OAUTH_REFRESH_TOKEN=1//0...   # the NEW token from step 4 (now 3 scopes)
```

**Separate-account path** — set the dedicated trio:
```
GOOGLE_YOUTUBE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_YOUTUBE_CLIENT_SECRET=...
GOOGLE_YOUTUBE_REFRESH_TOKEN=1//0...
```
Optional either way (defaults to the church playlist, identical to ms.church):
```
YOUTUBE_PLAYLIST_ID=PLHs3usNpG0bZHnAJlIpwBtkbnd7xDCeRC
```
Redeploy.

### 6. Verify
Open the CRM **Sermons** tab → **Run now**. Watch the run: detect → transcribe →
segment should all go green and a sermon appears at **review**. Open it, skim the
chapters + transcript, then **Publish**. It shows on ms.church within ~5 minutes.

---

## Already done for you (no action needed)

- **Database**: `sermons` + `sermon_pipeline_runs` tables (migration `0036`),
  RLS default-deny.
- **Weekly cron**: scheduled in Supabase pg_cron (migration `0037`), Monday 18:00
  UTC (~noon Boise), hitting `/api/cron/sermon-pipeline` with the existing
  `CRON_SECRET` + Vault secrets the Gmail/campaign crons already use. It is live
  now; until the token above is set it records one expected FAILED run/week,
  which self-heals the first Monday after you add the token.
- **Claude segmentation**: uses the existing `ANTHROPIC_API_KEY`; the model is
  switchable in **Settings → AI models** under "Sermon segmentation" (defaults to
  Opus / high).
- **Public feed**: `GET /api/public/sermons` (list) and `?slug=<x>` (one, with
  full transcript) — only `published` rows are ever exposed.

---

## Caption timing + quality notes

- **Auto-captions lag.** YouTube generates automatic captions within a few hours
  of upload (usually well under a day for a ~40-min video). Monday noon is chosen
  to be safely after that. If a week's captions are late, the run fails at
  transcribe; just hit **Run now** later that day.
- **Auto-captions are imperfect.** Expect minor transcription errors, missing
  punctuation, and no speaker labels. The segmenter is told to read for meaning,
  and the **review-before-publish** step is your quality gate — fix a chapter
  title or skip a bad week. This is why publishing is human-gated, never
  automatic.
- **Manually uploaded captions win.** If the church ever uploads a corrected
  caption track, the pipeline prefers the human track over the ASR one
  automatically.

---

## Keeping it alive

Same as Events: a **Production** refresh token doesn't expire under normal use,
but dies after ~6 months of total inactivity, or if the account revokes access /
changes its password. The weekly run keeps it warm. If transcription starts
failing with an auth error, re-mint (step 4) and update the token env var.

---

## Deferred (not built, by design)

- **Writing back to YouTube** (uploading a branded intro/outro, editing the
  video's title/description/chapters from the CRM). A published YouTube video
  can't be re-edited in place via API, intro insertion can't run on Vercel
  serverless, and none of it helps SEO — do channel branding live in
  OBS/YouTube Studio. The on-site chaptered transcript is where the SEO value is.
- **Hosted ASR** (Whisper/Deepgram). Not needed while YouTube's own captions are
  available and free; the captions client is the single transcription source.
```
