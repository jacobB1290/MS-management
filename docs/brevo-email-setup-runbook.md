# Brevo email — provisioning runbook (handoff runlist)

**Audience:** an operator or AI agent with access to the **Brevo**, **Cloudflare
(DNS for `ms.church`)**, and **Vercel (the CRM project)** dashboards. Follow the
phases top to bottom. Each step says **where to get the value** and **what to do**.

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
2. **Cloudflare zone:** `ms.church`.
3. **Brevo account:** create one at brevo.com if it doesn't exist (Free plan is
   fine to start). The church is a nonprofit — check Brevo's nonprofit program.
4. **Do NOT touch the root `MX` record.** It stays on Google so `support@ms.church`
   and all normal church mail keep working. We only add *sending* authentication.

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

## Phase 2 — Authenticate the `ms.church` domain (Cloudflare DNS)

> If the domain is NOT authenticated, Brevo rewrites your From address to
> `@brevosend.com` — unprofessional and bad for deliverability. Do this before any
> real send. **Copy the exact records from Brevo** (selectors can change); the
> names below are the shape to expect.

1. Brevo → **Senders, Domains & Dedicated IPs → Domains → Add a domain** →
   `ms.church` → *Authenticate*. Brevo shows the DNS records to publish.
2. In **Cloudflare → DNS → Records** for `ms.church`, add what Brevo shows
   (set proxy status to **DNS only / grey cloud** for all of these):
   - **Domain-verification TXT** — host `@` (or as shown), value `brevo-code:<token>`.
   - **DKIM** — the CNAME/TXT records Brevo provides (commonly `mail._domainkey`
     and `mail2._domainkey`). Copy host + target verbatim from the dashboard.
   - **SPF** — ensure the domain's SPF TXT includes Brevo. There must be exactly
     ONE SPF record; merge, don't duplicate:
     `v=spf1 include:spf.brevo.com include:_spf.google.com ~all`
     (keep the existing Google include so normal mail still passes).
   - **DMARC** — if none exists, add a TXT at `_dmarc` →
     `v=DMARC1; p=none; rua=mailto:dmarc@ms.church;` (start at `p=none`, tighten later).
3. Back in Brevo, click **Verify / Authenticate** until the domain shows
   **Authenticated** (DNS can take a few minutes to propagate).

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

## Teardown — remove SendGrid (do after Brevo is verified)

**Vercel:** delete the 8 `SENDGRID_*` / inbound vars listed in *REMOVE* above.

**SendGrid dashboard:**
- **Settings → Mail Settings / Event Webhook:** turn OFF the Event Webhook.
- **Settings → Inbound Parse:** delete the host entry for the reply subdomain.
- **Settings → API Keys:** revoke the CRM's API key.
- Optionally downgrade/close the SendGrid account once mail is flowing on Brevo.

**Cloudflare DNS (remove SendGrid's records — keep Google's):**
- Delete SendGrid **DKIM** CNAMEs: `s1._domainkey`, `s2._domainkey`.
- Delete SendGrid **link-branding/tracking** CNAMEs: `em####`, `url####`,
  and any `*.sendgrid.net` CNAME the old setup added.
- Remove `include:sendgrid.net` from the SPF TXT (leave Brevo + Google includes).
- Delete the inbound `MX` on the reply subdomain (e.g. `reply.ms.church` →
  `mx.sendgrid.net`). It's no longer used (replies go to Gmail via Reply-To).
- **Leave the root `MX` (Google) untouched.**

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
