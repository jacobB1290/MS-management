# Brevo email — provisioning runbook (handoff runlist)

**Audience:** an operator or AI agent with access to the **Brevo** and **Vercel**
dashboards. DNS for `ms.church` is managed in **Vercel DNS** (the domain's
nameservers point to Vercel; registrar is GoDaddy), so DNS records go in Vercel
too — not Cloudflare. Follow the phases top to bottom. Each step says **where to
get the value** and **what to do**.

**What this sets up:** the CRM now sends ALL email through **Brevo** — both 1:1
inbox replies (Brevo *transactional* API) and newsletter/promo **blasts** (Brevo
*campaign* API). Replies are NOT ingested back into the CRM: outgoing mail carries
`Reply-To: support@ms.church`, so a recipient's reply lands in **Google Workspace
(Gmail)** where a human answers it. *Brevo sends; Google receives.*

**Before / safe state:** the code ships in **mock mode** until `BREVO_API_KEY` is
set — email is logged, not sent, and nothing breaks. So you can deploy first and
provision Brevo second. Until you finish Phase 2 (domain auth), do not run a real
blast.

**Free tier (important):** Brevo Free = **300 emails/day, shared** across 1:1 +
blasts. The app enforces this with `BREVO_DAILY_SEND_CAP` (default 300): a blast
whose eligible audience exceeds the cap is refused rather than truncated. Keep the
congregation list lean, or upgrade (Brevo has nonprofit pricing — the church is a
501(c)(3)).

---

## Provisioning status (2026-06-15) — LIVE

Brevo is provisioned and **verified live in production** (a real authenticated 1:1
send passed SPF + DKIM + DMARC on mail-tester). Done: domain authenticated in
**Vercel DNS**; sender `Morning Star Church <newsletter@ms.church>` verified;
Vercel env set on Production + Preview (`BREVO_API_KEY`, `BREVO_FROM_EMAIL`,
`BREVO_FROM_NAME`, `BREVO_REPLY_TO_EMAIL`, `BREVO_WEBHOOK_TOKEN`;
`BREVO_LIST_FOLDER_ID` / `BREVO_DAILY_SEND_CAP` left unset → code defaults, cap
300), redeployed out of mock mode; marketing webhook **CRM suppression sync**
active (events: unsubscribed / complaint / hardBounce).

**Open follow-ups (Jacob/later — not blocking, no code change):**
- [ ] Prove the unsubscribe round-trip end-to-end: send a campaign to a test
      contact, click unsubscribe, confirm `contacts.email_unsubscribed_at` sets +
      next-audience exclusion.
- [ ] Confirm a recipient reply lands in `support@ms.church` (Gmail).
- [ ] Confirm the CAN-SPAM postal address shows in the Brevo campaign footer.
- [ ] **SendGrid teardown — only after a bake-in** (see Teardown below).
- [ ] Clean up the throwaway freemail Brevo sender + any mail-tester test contact.

---

## Quick reference — environment variables

### ADD in Vercel (CRM project → Settings → Environment Variables → Production + Preview)

| Variable | Where to get it / what to set | Required |
|---|---|---|
| `BREVO_API_KEY` | Brevo → account menu (top-right) → **SMTP & API → API Keys** → *Generate a new API key*. Copy immediately (shown once). | **Yes** — without it, email stays in mock mode |
| `BREVO_FROM_EMAIL` | The verified sender address, e.g. `newsletter@ms.church`. Must be authenticated (Phase 2). | **Yes** |
| `BREVO_FROM_NAME` | Display name, e.g. `Morning Star Church`. | Recommended |
| `BREVO_REPLY_TO_EMAIL` | `support@ms.church` (the Google Workspace mailbox replies go to). | Recommended (defaults to `support@ms.church`) |
| `BREVO_WEBHOOK_TOKEN` | A long random secret you generate (e.g. `openssl rand -hex 32`). Used to authenticate the Brevo webhook. | **Yes** — without it, unsubscribes don't sync back |
| `BREVO_LIST_FOLDER_ID` | Optional. Brevo → **Contacts → Folders**; create/cite a folder id that per-campaign lists live under. If unset, the app creates a folder on demand. | Optional |
| `BREVO_DAILY_SEND_CAP` | Optional. Defaults to `300` (the free-tier daily budget). Raise only after upgrading the Brevo plan. | Optional |

> `PHYSICAL_MAILING_ADDRESS` already exists and is the CAN-SPAM postal address.
> With Brevo it is no longer injected by code — paste it into Brevo's campaign
> footer / sender settings (Phase 4).

### REMOVE in Vercel (delete these — they are dead now)

`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`,
`SENDGRID_UNSUBSCRIBE_GROUP_ID`, `SENDGRID_WEBHOOK_PUBLIC_KEY`,
`INBOUND_EMAIL_DOMAIN`, `SENDGRID_INBOUND_TOKEN`, `EMAIL_UNSUBSCRIBE_SECRET`.

After changing env vars, **redeploy** (Vercel → Deployments → Redeploy, or push a
commit) so the new values take effect.

---

## Phase 0 — Confirm the targets

1. **Vercel project:** the CRM (the app that serves `APP_BASE_URL`). Note its
   production URL — you need it for the webhook (`<APP_BASE_URL>/api/webhook/brevo`).
2. **DNS:** `ms.church` runs on **Vercel DNS** (nameservers point to Vercel;
   registrar is GoDaddy). Add records in Vercel → the `ms.church` domain → DNS
   Records. (Not Cloudflare.)
3. **Brevo account:** create one at brevo.com if it doesn't exist (Free plan is
   fine to start). The church is a nonprofit — check Brevo's nonprofit program.
4. **Do NOT touch the apex `MX` record** (Google, `smtp.google.com`). It keeps
   `support@ms.church` and all normal church mail working. We only add *sending*
   authentication.

---

## Phase 1 — Brevo API key + sender

1. **API key:** Brevo → account menu → **SMTP & API → API Keys → Generate a new
   API key**. Set it as `BREVO_API_KEY` in Vercel. (Server-only — never put it in
   a `NEXT_PUBLIC_*` var or client code.)
2. **Sender:** Brevo → **Senders, Domains & Dedicated IPs → Senders → Add a
   sender**: `Morning Star Church <newsletter@ms.church>` (or whatever you set as
   `BREVO_FROM_EMAIL`). Brevo emails a confirmation code to that address — confirm
   it. Add `support@ms.church` as a sender too if you want it selectable.

---

## Phase 2 — Authenticate the `ms.church` domain (Vercel DNS)

> If the domain is NOT authenticated, Brevo rewrites your From address to
> `@brevosend.com` — unprofessional and bad for deliverability. Do this before any
> real send. **Copy the exact records from Brevo** and add them in Vercel DNS.

1. Brevo → **Senders, Domains & Dedicated IPs → Domains → Add a domain** →
   `ms.church` → *Authenticate*. Brevo shows the DNS records to publish.
2. In **Vercel → the `ms.church` domain → DNS Records**, add what Brevo shows. For
   ms.church these were:
   - **Domain-verification TXT** — host `@`, value `brevo-code:<token>`.
   - **DKIM** — two CNAMEs, `brevo1._domainkey` and `brevo2._domainkey` (copy the
     targets verbatim from the Brevo dashboard).
   - **SPF** — there must be exactly ONE apex SPF TXT. ms.church had none, so a new
     one was added (keep the Google include so normal mail still passes):
     `v=spf1 include:spf.brevo.com include:_spf.google.com ~all`
   - **DMARC** — Brevo **refuses to authenticate without a `rua`** reporting
     address. The existing `_dmarc` TXT got `rua=mailto:rua@dmarc.brevo.com` added
     (`p=none` left unchanged). If no `_dmarc` exists, add
     `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com;`.
3. Back in Brevo, click **Authenticate** until `ms.church` shows **Authenticated**
   (DNS can take a few minutes). It currently shows Authenticated.

---

## Phase 3 — Register the unsubscribe/bounce webhook

Brevo does **not** sign webhooks, so the app authenticates it with a secret token
in the URL (`BREVO_WEBHOOK_TOKEN`). The webhook keeps the CRM's opt-out state in
sync: `unsubscribed` / `spam` / `hardBounce` → `contacts.email_unsubscribed_at`.

1. Generate the secret and set it in Vercel:
   `BREVO_WEBHOOK_TOKEN = <openssl rand -hex 32 output>`.
2. Register the webhook. Either:
   - **Dashboard:** Brevo → **Transactional/Logs → Settings → Webhook** (or
     **Contacts → Settings → Webhooks** for the marketing type) → *Add a webhook* →
     URL: `https://<APP_BASE_URL>/api/webhook/brevo?token=<BREVO_WEBHOOK_TOKEN>` →
     type **Marketing** → events: **Unsubscribed, Hard bounce, Spam (complaint)**.
   - **API:**
     ```
     curl -X POST https://api.brevo.com/v3/webhooks \
       -H "api-key: $BREVO_API_KEY" -H "content-type: application/json" \
       -d '{"url":"https://<APP_BASE_URL>/api/webhook/brevo?token=<TOKEN>",
            "type":"marketing","events":["unsubscribed","hardBounce","spam"],
            "description":"CRM suppression sync"}'
     ```
   (Register with camelCase event names — `hardBounce`, `unsubscribed`. Brevo's
   *payloads* use snake_case — the app already handles that.)

---

## Phase 4 — Compliance footer + templates

1. **Postal address (CAN-SPAM):** put `PHYSICAL_MAILING_ADDRESS` into the footer
   of your campaign templates and/or Brevo's sender/branding settings. Bulk mail
   must carry it. (Brevo also auto-inserts the unsubscribe link — never remove it.)
2. **Templates:** design newsletter/promo templates in Brevo → **Campaigns →
   Templates**. The CRM's campaign composer lists these (the *Brevo template*
   field → *Browse*) so staff pick one by id. The numeric template id is what the
   CRM stores (`campaigns.brevo_template_id`).

---

## Phase 5 — Set the Vercel env + redeploy

1. Add every **ADD** variable from the Quick Reference (Production + Preview).
2. Delete every **REMOVE** variable.
3. **Redeploy** so the running app picks them up.
4. Settings page check: open the CRM → **Settings** → the status panel should show
   **Brevo API: Configured** and **Brevo webhook: Token configured**.

---

## Phase 6 — Validate (definition of done)

- [ ] Brevo dashboard shows `ms.church` **Authenticated** (From is NOT rewritten
      to `@brevosend.com`).
- [ ] Send a test: from the CRM inbox, send a 1:1 email to a mail-tester.com
      address → confirm **SPF, DKIM, DMARC all pass** (mail-tester or raw headers).
- [ ] Reply to a sent email → it arrives in **`support@ms.church` (Gmail)**.
- [ ] Create a small email campaign in the CRM, send it → it goes out via Brevo
      (Brevo → Campaigns shows it), From the church address, Reply-To support.
- [ ] Click the unsubscribe link in a received campaign → within a few minutes the
      contact shows **unsubscribed** in the CRM (`email_unsubscribed_at` set). This
      proves the webhook + token are wired correctly.
- [ ] That contact is then **excluded** from the next campaign's eligible audience.

---

## Teardown — remove SendGrid (after Brevo is verified AND a short bake-in; the dashboard steps need a SendGrid login)

**Vercel:** delete the 8 `SENDGRID_*` / inbound vars listed in *REMOVE* above.

**SendGrid dashboard:**
- **Settings → Mail Settings / Event Webhook:** turn OFF the Event Webhook.
- **Settings → Inbound Parse:** delete the host entry for the reply subdomain.
- **Settings → API Keys:** revoke the CRM's API key.
- Optionally downgrade/close the SendGrid account once mail is flowing on Brevo.

**Vercel DNS (remove SendGrid's records — keep Google's). The specific records on
ms.church are:**
- the inbound **`MX`** on the reply subdomain (→ `mx.sendgrid.net`) — replies go to
  Gmail now, so it's dead.
- SendGrid **DKIM** CNAMEs `s1._domainkey`, `s2._domainkey`.
- SendGrid **link-branding/tracking** CNAMEs `em2736`, `url8464`, `108042600`.
- SPF already **excludes** SendGrid (the apex SPF from Phase 2 only includes Brevo
  + Google), so there's nothing to strip there.
- **Leave the apex `MX` (Google, `smtp.google.com`) untouched.**

---

## Gmail mirror — show the full email conversation in the CRM

The CRM mirrors the `support@ms.church` mailbox so a contact's thread shows the
WHOLE email conversation — their replies AND anything you compose in Gmail —
regardless of how it was sent. This is a Gmail-API read sync (Brevo can't see
Gmail-composed mail or replies). It runs on the cron, is idempotent, and threads
only to EXISTING contacts matched by email (mailbox noise won't create junk
contacts). No token → it's a no-op.

**Setup (once):**
1. **Identity.** The token must act AS the `support@ms.church` Workspace mailbox
   (NOT the gmail.com calendar account). Reuse the OAuth app
   (`GOOGLE_OAUTH_CLIENT_ID/SECRET`); just add the Gmail scope.
2. **Scope + refresh token** for `support@ms.church`:
   - In Google Cloud console, add scope
     `https://www.googleapis.com/auth/gmail.readonly` (add `.../gmail.send` too if
     you'll later send 1:1 through Gmail — Phase 2).
   - Run the OAuth consent **signed in as `support@ms.church`**, with
     `access_type=offline&prompt=consent`; copy the refresh token.
   - Publish the OAuth app to **Production** (same gotcha as the calendar — a
     "Testing" app's refresh token expires in 7 days).
3. **Vercel env:** set `GOOGLE_GMAIL_REFRESH_TOKEN` (and `GOOGLE_GMAIL_ADDRESS` if
   the mailbox isn't `support@ms.church`). Redeploy.
4. **Google Workspace DKIM** for `ms.church` (Google Admin → Apps → Gmail →
   Authenticate email) + the `google._domainkey` TXT in Vercel DNS — so mail you
   send from Gmail is DKIM-signed on the domain.

**Verify:** Settings → System shows **Gmail mirror: Syncing**. Reply to a CRM email
from your phone → within a cron tick it appears in that contact's CRM thread; send
a fresh email to a known contact straight from Gmail → it shows up too.

**Note:** the apex `MX` stays on Google (`smtp.google.com`) — that's what lets the
mailbox receive at all; don't change it.

---

## Rollback

The code change is what flips providers; env vars only switch real-vs-mock. To
roll back, revert the PR. To pause sending without reverting, unset `BREVO_API_KEY`
(email returns to mock mode — logged, not sent — and nothing errors).

## Where each variable is read (for trust)

- `BREVO_API_KEY`, `BREVO_FROM_*`, `BREVO_REPLY_TO_EMAIL` → `src/server/comms/brevo.ts`
- `BREVO_LIST_FOLDER_ID`, `BREVO_DAILY_SEND_CAP` → `src/server/comms/brevoCampaign.ts`
- `BREVO_WEBHOOK_TOKEN` → `src/server/webhooks/verify.ts` (`verifyBrevoWebhookToken`)
- Webhook receiver → `src/app/api/webhook/brevo/route.ts`
