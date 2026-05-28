# Email setup runbook (for a Claude computer-use agent)

This is a step-by-step runbook to finish wiring **two-way email** for the
MS-management CRM. The code is already deployed; what remains is **external
configuration** in three dashboards: **Vercel** (env + DNS), **SendGrid**
(sender auth, unsubscribe group, Event Webhook, Inbound Parse), and a quick
end-to-end test.

You (the agent) drive the browser. Where a value must come from a human, **ask
the operator** with the exact prompt given. Where a value is a secret, **you
generate it** with the command shown, then paste it into every place listed.
Do not invent domains, addresses, or keys.

> **Sending works as soon as Part B is done. Receiving (replies threading into
> the inbox) needs Parts A + C + D.** Until then, sending is fine and inbound
> stays dormant — nothing breaks.

---

## 0. Information to collect from the operator first

Ask the operator for these and write them down before touching any dashboard:

| Ask the operator | Example | Used in |
|---|---|---|
| "What domain should email come **from**?" | `ms.church` | SendGrid sender auth, `SENDGRID_FROM_EMAIL` |
| "What from-address and display name?" | `hello@ms.church`, `Morning Star Church` | `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME` |
| "What **subdomain** can we use to receive replies?" (must not be the domain that already gets the church's real mail) | `reply.ms.church` | `INBOUND_EMAIL_DOMAIN`, MX record, Inbound Parse |
| "What is the church's **physical mailing address**?" (CAN-SPAM requires it on bulk email) | `3080 N Wildwood St, Boise, ID 83713` | `PHYSICAL_MAILING_ADDRESS` |
| "Do you have a SendGrid account + login?" (you'll need access) | — | all SendGrid steps |
| "Confirm the production app URL." | `https://crm.ms.church` | `APP_BASE_URL` |

Secrets **you** generate (run locally, save the output):

```bash
# Inbound Parse webhook auth token
openssl rand -hex 32      # -> SENDGRID_INBOUND_TOKEN
# Unsubscribe-link signing secret
openssl rand -hex 32      # -> EMAIL_UNSUBSCRIBE_SECRET
```

---

## Part A — DNS (Vercel → Domains → the domain → DNS records)

Go to **vercel.com → the project's team → Domains** (or **Settings → Domains**),
select the domain (e.g. `ms.church`), open **DNS Records**.

1. **Inbound MX** — add a record:
   - Type: `MX`
   - Name/Host: the subdomain label only, e.g. `reply` (for `reply.ms.church`)
   - Value/Target: `mx.sendgrid.net`
   - Priority: `10`
2. Leave SPF/DKIM/DMARC for Part B (SendGrid generates the exact records).

> If DNS for the domain is **not** at Vercel, ask the operator where the domain's
> DNS is hosted and add the same records there instead.

---

## Part B — SendGrid sending (auth + unsubscribe group + event webhook)

Log in at **app.sendgrid.com**.

### B1. Sender / domain authentication (deliverability)
**Settings → Sender Authentication → Authenticate Your Domain.** Enter the
from-domain (`ms.church`). SendGrid shows several **CNAME** records (DKIM, link
branding) — add each one in Vercel DNS (Part A location), then click **Verify**.
This is what keeps mail out of spam and is required for one-click unsubscribe.

### B2. API key
**Settings → API Keys → Create API Key** (Full Access or at least Mail Send +
Inbound Parse). Copy the key once — it's shown only once. → `SENDGRID_API_KEY`.

### B3. Unsubscribe group (required for bulk/marketing)
**Settings → Unsubscribe Groups → Create a Group.** Name it (e.g.
"All church email"). Open the group and copy its **numeric ID**. →
`SENDGRID_UNSUBSCRIBE_GROUP_ID`.

### B4. Event Webhook (mirrors unsubscribes/bounces back to the CRM)
**Settings → Mail Settings → Event Webhook** (or **Settings → Event Webhook**):
- HTTP Post URL: `https://<APP_BASE_URL>/api/webhook/sendgrid`
- Enable: Delivered, Bounced, Dropped, Spam Reports, Unsubscribes, Group
  Unsubscribes (opens/clicks optional).
- Turn on **Signed Event Webhook** → copy the **Verification Key (public key)**.
  → `SENDGRID_WEBHOOK_PUBLIC_KEY`.
- Save / toggle the webhook **on**.

---

## Part C — SendGrid Inbound Parse (receiving replies)

**Settings → Inbound Parse → Add Host & URL:**
- Receiving Domain: the subdomain from step 0, e.g. `reply.ms.church`
  (must match the MX record in Part A and `INBOUND_EMAIL_DOMAIN`).
- Destination URL:
  `https://<APP_BASE_URL>/api/webhook/sendgrid-inbound?token=<SENDGRID_INBOUND_TOKEN>`
  (paste the token you generated in step 0).
- Check **POST the raw, full MIME message** is **off** (we parse the fields), and
  leave spam check optional.
- Save.

---

## Part D — Vercel environment variables

**Vercel → the project → Settings → Environment Variables.** Add each below for
**Production** (and Preview if used). After saving, **redeploy** so they apply.

| Variable | Value | Source |
|---|---|---|
| `SENDGRID_API_KEY` | the key from B2 | SendGrid |
| `SENDGRID_FROM_EMAIL` | `hello@ms.church` | operator |
| `SENDGRID_FROM_NAME` | `Morning Star Church` | operator |
| `SENDGRID_UNSUBSCRIBE_GROUP_ID` | numeric id from B3 | SendGrid |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | key from B4 | SendGrid |
| `PHYSICAL_MAILING_ADDRESS` | the church address | operator |
| `INBOUND_EMAIL_DOMAIN` | `reply.ms.church` | operator/step 0 |
| `SENDGRID_INBOUND_TOKEN` | the `openssl` value | you generated |
| `EMAIL_UNSUBSCRIBE_SECRET` | the `openssl` value | you generated |
| `APP_BASE_URL` | `https://crm.ms.church` | operator (if not already set) |

> The `SENDGRID_INBOUND_TOKEN` you paste here **must byte-match** the `?token=`
> in the Inbound Parse URL (Part C). If they differ, inbound returns 403.

---

## Part E — Database migration

The schema change (`supabase/migrations/0025_email_two_way.sql`) must be applied
to the Supabase project, then types regenerated. If the operator's deploy
pipeline applies migrations automatically, confirm `0025` ran. Otherwise apply
it via the Supabase MCP `apply_migration` tool (per CLAUDE.md §4) and regenerate
`src/lib/database.types.ts`. **Do not** hand-edit schema in the Supabase
dashboard.

---

## Part F — End-to-end verification

1. **Send:** In the CRM inbox, open a contact that has an email, switch the
   composer to **Email**, send a short message. Confirm it arrives in a real
   inbox and the bubble shows "Sent" (not "Recorded without sending" — that
   means `SENDGRID_API_KEY`/`SENDGRID_FROM_EMAIL` are missing).
2. **Reply / receive:** Reply to that email. Within a few seconds it should
   appear as an inbound bubble in the same conversation. If not, check:
   Vercel logs for `/api/webhook/sendgrid-inbound` (403 = token mismatch;
   no hit = MX/Inbound Parse misconfig).
3. **Unsubscribe:** In the received email, use the mail client's "Unsubscribe"
   affordance (List-Unsubscribe). Confirm the contact's email status flips to
   unsubscribed in the CRM and the composer refuses to send email to them.
4. **Event mirror:** A bounce or unsubscribe should appear via the Event
   Webhook and set `email_unsubscribed_at`.

---

## Quick failure map

| Symptom | Likely cause | Fix |
|---|---|---|
| Bubble says "Recorded without sending" | `SENDGRID_API_KEY` or `SENDGRID_FROM_EMAIL` unset | Part D |
| Outbound lands in spam | Domain auth incomplete | Part B1 (verify CNAMEs) |
| Reply never appears | MX missing / Inbound Parse host wrong | Parts A, C |
| Inbound webhook 403 in logs | token mismatch | make Part C `?token=` == Part D `SENDGRID_INBOUND_TOKEN` |
| Reply made a new contact instead of threading | older email had no Reply-To token; matched by sender — expected fallback | none (working as designed) |
| Campaign send refused | no unsubscribe group | Part B3 + Part D |
