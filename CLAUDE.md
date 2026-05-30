# CLAUDE.md — MS Management (CRM + comms engine)

This file is the working agreement for anyone (human or AI) building in this
repo. Read it before touching code. It carries the cross-cutting standards
from the `ms.church` `website-V2` `CLAUDE.md` and adds the rules that are
specific to this product — a staff console that holds personal contact data,
messages, and provider API keys.

---

## 1. Mission

CRM + two-way SMS + email engine for Morning Star Christian Church. Owned,
low-cost, and consistent with the public ms.church site's design language so
the two products feel like one family. Staff-only, behind auth.

The reason this is custom: every low-cost CRM with real two-way SMS has
predatory pricing, per-seat fees, and feature-gating. We control the whole
stack, and we keep it cheap and clean.

## 2. Stack (locked)

| Layer | Choice |
|---|---|
| Frontend / Operator UI | Next.js 16 (App Router) on Vercel |
| Styling | Tailwind v4 + design tokens (CSS vars) + shadcn-style primitives |
| Database / Auth / Realtime | Supabase (Postgres) |
| Backend logic | Next.js Route Handlers + Supabase Edge Functions |
| SMS / MMS | Twilio Programmable Messaging (Messaging Service + 10DLC) |
| Email | SendGrid Email API (Dynamic Templates by ID; not Marketing Campaigns) |
| Testing harness | Playwright (visual + multi-viewport screenshots) |
| Cron | GitHub Actions (heartbeat) |

**Supabase project:** `nhrgbjkiiqpzwdgsvdrl` (region `us-west-1`). Free tier.

**Non-choices on purpose:** Twilio Conversations API; SendGrid Marketing
Campaigns; RCS; paid Supabase (until we want backups + warm-up).

## 3. Architecture — four layers, hard wall between them

1. **Operator UI** (Next.js). Never holds privileged keys. All privileged
   actions call a server endpoint or an Edge Function.
2. **Server endpoints** (Route Handlers / Edge Functions). Only place that
   touches Twilio/SendGrid secrets and the service-role Supabase key.
3. **Database** (Supabase Postgres). RLS on every table, default-deny.
4. **Pipes** (Twilio, SendGrid). Dumb send/receive. Never trusted as a
   source of identity — verify their webhook signatures.

**Hard rule:** the browser never sees the service-role key, the Twilio auth
token, or the SendGrid API key. Every send, every privileged DB write goes
through a server-side path.

## 4. Data model

Six core tables + three supporting. See `supabase/migrations/0001_init.sql`.

- `contacts` — name, phone (E.164, `CHECK ~ '^\+[1-9]\d{1,14}$'`, `UNIQUE`),
  email (citext), tags (text[], GIN), language (en/ru), `sms_opted_out_at`,
  `email_unsubscribed_at`, `consent_method`, `consent_at`, notes.
  - **Single source of truth for opt-out: `*_opted_out_at TIMESTAMPTZ NULL`.**
    `NULL` means opted in. No separate boolean.
- `messages` — direction, body, media_url, channel (sms/mms),
  `twilio_sid UNIQUE` (idempotency), status, error, campaign_id, sent_by.
- `campaigns` — channel (sms/email), body or sendgrid_template_id,
  audience_filter (jsonb), status state machine.
- `campaign_recipients` — composite PK, per-recipient status incl.
  `skipped_opt_out` and `skipped_unsubscribed`.
- `email_events` — `sendgrid_event_id UNIQUE` (idempotency); trigger auto-syncs
  unsubscribe/spamreport back to `contacts.email_unsubscribed_at`.
- `form_submissions` — immutable proof-of-opt-in.
- `app_users` — `auth.users.id` → role (`admin` | `member`).
- `audit_log` — write-only privileged action log.
- `heartbeat` — single row, kept warm by GH Actions cron.

**Migrations are the only way to change schema.** Never hand-edit via the
dashboard. New migration file under `supabase/migrations/` + apply via the
Supabase MCP `apply_migration` tool. Regenerate
`src/lib/database.types.ts` after schema changes.

## 5. Security — zero leak, non-negotiable

These rules are load-bearing. Don't bend them.

1. **RLS on every table, default-deny.** Use the `app.is_admin()` /
   `app.is_staff()` helpers in policies; both are `SECURITY DEFINER` and
   bypass RLS internally to avoid recursion.
2. **The frontend uses only the publishable (anon) key.** Service-role key
   stays in server env. Never imported in a file under `src/app` that runs
   in a client component (`"use client"`).
3. **Webhook signature verification before any DB write.** Twilio:
   `X-Twilio-Signature` HMAC-SHA1 over URL + sorted params. SendGrid:
   ECDSA on `(timestamp + body)`. Reject anything that doesn't validate.
4. **Phone normalization to E.164 on every entry point.** Use
   `src/server/validation/phone.ts`. The DB CHECK is a safety net, not the
   primary gate.
5. **Idempotency.** `messages.twilio_sid` and `email_events.sendgrid_event_id`
   are `UNIQUE`. Always insert with `ON CONFLICT DO NOTHING` from webhooks.
6. **Audit log for every privileged write** — sends, opt-out toggles,
   contact edits, campaign starts, logins. Use
   `src/server/audit.ts:logAudit()`. Reads are not audited; the threat is
   unauthorized writes, not legitimate viewing.
7. **HTTPS only.** Secure cookies via Supabase SSR helpers.
8. **PII minimization.** Don't collect data we don't use. Don't log message
   bodies into observability tools.

## 6. Compliance — at the function level, not just the UI

Enforce these in `src/server/comms/*`, not just behind a disabled button.

- **SMS opt-out (STOP).** Twilio auto-blocks at the carrier. We also catch
  the STOP webhook → `sms_opted_out_at = now()` → and `sendSms()` refuses
  to send to a contact where `sms_opted_out_at IS NOT NULL`. UI shows a
  banner; the function is the wall.
- **Email unsubscribe (CAN-SPAM).** Every bulk email includes a working
  unsubscribe link (SendGrid unsubscribe group) and our physical mailing
  address (`PHYSICAL_MAILING_ADDRESS` env). The SendGrid Event Webhook
  mirrors unsubscribes back to `contacts.email_unsubscribed_at`. 1:1 inbox
  email (`sendDirectEmail`) is a true personal reply and deliberately carries
  NO List-Unsubscribe header — that header is what makes mail clients brand a
  message as a mailing list, which is wrong for a 1:1 and hurts the
  relationship. Opt-out is still enforced three ways: `assertCanSendEmail` (the
  wall), the inbound webhook's plain-language STOP/unsubscribe reply, and the
  in-CRM `email_unsubscribed_at` toggle. (`unsubscribeHeaders` /
  `/api/email/unsubscribe` remain available for any future bulk-via-app path.)
- **Consent capture.** Every contact has `consent_method` and `consent_at`.
  Form submissions are the canonical proof; CSV imports must explicitly
  record `consent_method = 'csv_import_<batch>'` and a real `consent_at`.
- **Rate discipline.** SMS sends go through the Twilio Messaging Service so
  metering and 10DLC throughput are automatic. Never call the raw send
  endpoint directly in batch contexts.

### 6.1 Email consent model — how it legally works + who owns what

SMS and email are governed by **different laws**, so they behave differently.
Do not copy the SMS mental model onto email.

- **SMS = TCPA (opt-IN).** Need prior express consent before marketing. Twilio
  Advanced Opt-Out answers STOP **at the carrier** automatically.
- **Email = CAN-SPAM (opt-OUT).** You may email first; you MUST honor opt-outs
  and, for **commercial/bulk** mail, include a working unsubscribe + physical
  postal address. There is **no carrier STOP for email** — opt-out is the
  unsubscribe link / List-Unsubscribe header / a recipient reply.

**Transactional vs commercial is the hinge.** CAN-SPAM's strict rules
(unsubscribe link, postal address) apply to **commercial** mail only.
- **1:1 inbox email** (`sendDirectEmail`) is treated as **transactional** — it
  reads like a real personal reply (clean single column, a warm human sign-off
  with the sender's name, no masthead/footer, no List-Unsubscribe header). The
  goal is that a recipient feels a person wrote to *them*, not that they got a
  nice template. CAN-SPAM exempts transactional 1:1 mail from the unsubscribe +
  postal-address requirements, and we still respect `email_unsubscribed_at` and
  honor a plain-language "stop" reply, so we're covered even if a 1:1 drifts
  commercial.
- **Campaign/bulk email** is **commercial** → the unsubscribe group
  (`SENDGRID_UNSUBSCRIBE_GROUP_ID`) + postal address are **required**, and the
  send path refuses without the group.

**Responsibility split:**

| Concern | CRM | SendGrid (the email pipe) |
|---|---|---|
| Source of truth for opt-out | `contacts.email_unsubscribed_at` (`NULL` = subscribed); `assertCanSendEmail` is the wall | Suppression / unsubscribe **group** — drops a send even if our flag is stale |
| Consent record | `consent_method` / `consent_at` | — |
| Catch a reply that says "stop" | inbound webhook (`detectOptOutKeyword` on body + subject) | — (no auto reply-keyword handler) |
| Unsubscribe link / one-click | bulk only: `/api/email/unsubscribe` (signed) + `List-Unsubscribe` header. 1:1 sends none (personal reply); opt-out via the wall + STOP reply + CRM toggle | hosts the group's unsubscribe page for bulk |
| Bounce / spam / unsub events | `email_events` trigger mirrors back to the flag | Event Webhook posts the events |

Re-enabling email in the CRM only clears the **local** flag; a contact who used
a SendGrid unsubscribe link stays suppressed in the group until removed there
(the next send drops and the `dropped` event self-heals the flag).

**External setup needed:** domain auth (SPF/DKIM/DMARC) for deliverability;
unsubscribe group; postal address; Event Webhook; and for two-way, the Inbound
Parse + MX + token (see §13.1 and `docs/email-setup-runbook.md`). Heads-up: this
is the US/CAN-SPAM model — **CASL (Canada) / GDPR (EU) are opt-IN**; if the
church emails international contacts, revisit. Not legal advice — confirm with
counsel.

## 7. Design language — carried from ms.church `website-V2`

Read `src/app/globals.css` for the full token set; read `src/design/tokens.ts`
for the typed view. Highlights:

- **Palette:** warm cream surface (`--bg`, `--surface`), gold `#9d7853`
  accent (+ dark/deeper variants), alpha-based text scale.
- **Type:** Playfair Display (display), Inter (body/UI). Fluid `clamp()` scale
  from `--text-hero` to `--text-eyebrow`. Min body 16px, min button 14px.
- **Spacing:** t-shirt scale (`--space-xs` → `--space-3xl`), all fluid.
- **Radius / shadow / motion:** token tiers only.
- **Surface:** flush by default, cards by exception, never nested.
- **Curly quotes** in visible copy (U+2019 / U+201C / U+201D); ASCII in code.
- **Italic gold identity phrases** (`<em class="motto">`) without ASCII quotes.
- **No em dashes** in visible copy; restructure for flow.
- **One canonical CTA pill** (`.btn-cta`) with modifiers. Never fork the design.
- **Motion (non-negotiable):** animate everything that moves, and **every action
  must be animated.** The owner *hates* an action that just snaps — a tap, toggle,
  open/close, send, nav, optimistic update, appear/disappear all get a visible
  transition (the token motion tiers), never an instant state jump. A new
  affordance that pops in with no transition, or a value that hard-cuts, is a
  bug. Honor `prefers-reduced-motion` (it scales motion down, it does not excuse
  skipping it elsewhere). **"It animates" is the floor; "smooth and tasteful" is
  the bar** — every motion change gets an independent quality review before it
  ships (see §11).

### Adaptation from the marketing site

The site uses **sentence case + trailing periods** for headings ("How we serve
Boise."). That's editorial. **Inside the operator UI we drop the trailing
period** for chrome (buttons, table headers, modal titles, toasts) — periods
in product chrome read as typos. Visible editorial copy (e.g., the future
public form page, marketing emails) keeps the rule.

## 8. Platform-specific UX — two designs, one design system

**Hard requirement.** Don't build one layout and scale it for mobile.

- **Desktop:** multi-pane master-detail. Inbox = conversation list + open
  thread + contact panel side by side. Keyboard shortcuts.
- **Mobile:** single-focus stacked navigation. Conversation list → tap →
  full-screen thread → back. Compose anchored at the bottom for thumb
  reach. Touch targets ≥44px. Sticky compose plays well with mobile
  keyboard.
- **Shared:** the same tokens + primitive components. Layouts and
  interactions diverge; visual language does not.

The mobile reply UX is **as critical as desktop** — staff will live in it.

## 9. Engineering principles (carried from ms.church V2)

- **TypeScript strict.** No `any`, no `// @ts-ignore`. Refactor the code
  to satisfy the type system. `npm run build` runs `tsc --noEmit`; failing
  types fail the deploy.
- **Single source of truth.** Pass parameters, don't fork "looks-like"
  implementations. The canonical send path is `src/server/comms/sendSms.ts`
  and `src/server/comms/sendEmail.ts`. Every send goes through them.
- **Tokens are not suggestions.** Within ~30% of a token's value? Use the
  token. Same outlier in two places? Add a new token.
- **Read before adding.** Grep for related rules/components before writing.
- **Fix root cause, not symptom.** No `!important` to win specificity. No
  silent fallbacks to mask bugs.
- **Cross-component impact check.** Shared primitives touch everything.
- **Every action animates (load-bearing).** Before pushing any interaction,
  confirm it has a transition — no snapping. Buttons/affordances that conditionally
  render must reserve their space and fade/slide in (or be gated on server props so
  they're present on first paint), never pop in and shove the layout. A hard state
  jump where motion was possible is a defect, not a style nit. See §7 Motion.
- **Visual verification beats type-checking for UI.** Type-checking passes
  != layout works. Run the Playwright harness on a viewport matrix before
  pushing UI changes.
- **Test the matrix, not the example.** Mobile-360, mobile-393, tablet-768,
  desktop-1280, desktop-1440 at minimum for any layout work.
- **Proactive problem finding.** What's the version of this bug the user
  didn't mention but will hit next?

## 10. Conventions

- **Filenames:** kebab-case for routes (`/contact-detail/...`), camelCase
  for utilities (`sendSms.ts`), PascalCase for components.
- **CSS classes:** kebab-case (`.btn-cta`, `.contact-row`). Tailwind
  utilities preferred for layout; CSS classes for canonical patterns
  (`.btn-cta`, `.page`, `.eyebrow`, `.motto`).
- **Token names:** semantic, not value (`--space-md`, not `--20px`).
- **Routes:** App Router, `src/app/<segment>/page.tsx` per route, server
  components by default, `"use client"` only when interactivity demands it.
- **No raw provider IDs/strings in components.** Wrap in typed helpers.

## 11. Process

- **Small, reviewable steps.** One feature, one PR.
- **Migrations over manual changes.** Schema lives in versioned SQL.
- **State assumptions explicitly.** When ambiguous, ask.
- **Don't over-engineer.** Match the build to current scale.
- **Run the harness before pushing UI changes** (`npm run harness`).
  Update snapshots when intentional (`npm run harness:update`) and commit
  the new baselines.
- **Independent motion review — mandatory, every time it's relevant.** Whenever
  a change adds or alters motion (a transition, a newly animated affordance, an
  optimistic update, a slide/fade/open-close, anything that moves or appears),
  hand it to a *separate, unbiased agent* — one that did NOT write the change —
  to judge the motion quality, not just its presence: easing/timing feel, no
  jank, no layout shift, nothing abrupt, snappy or gratuitous, reduced-motion
  respected. Its findings are blocking polish, not optional notes — address them
  before shipping. The owner cares about this specifically and deeply: animated
  is the floor, *extremely smooth and tastefully done* is the requirement.

## 12. Environment variables

See `.env.example`. Required (set in Vercel + locally):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`,
  `TWILIO_PHONE_NUMBER`
- `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`,
  `SENDGRID_UNSUBSCRIBE_GROUP_ID`
- `PUBLIC_FORM_HMAC_SECRET` (HMAC the public website uses when posting
  form submissions to this app)
- `APP_BASE_URL`, `PHYSICAL_MAILING_ADDRESS`

Twilio + SendGrid creds can be empty during early UI development — the send
functions degrade to a logged-only mode so the inbox can be built and the
harness can run without provisioning a real Twilio number first.

## 13. Build sequence (per project brief §9)

1. Schema + migrations ✅
2. Twilio number + 10DLC registration (external, runs in background)
3. Inbound SMS webhook + outbound 1:1 send (the MVP)
4. Contacts UI + public website form receiver
5. Batch SMS via Messaging Service + central opt-out enforcement
6. Email via SendGrid (campaigns: template by ID + Event Webhook; two-way 1:1
   inbox email: `sendDirectEmail` + Inbound Parse webhook)
7. Polish: search, reporting, CSV import/export

## 13.1 Live provider setup — done and remaining

Operational (provider-side) config, separate from code. Current as of 2026-05.

**Done — Twilio.** Messaging Service `MG4a07acf58acc03b696ba922ec371692c`
("Claude Code Dev"), sender `+1 208 567 1893`. Advanced Opt-Out enabled, so
STOP/START/HELP are auto-answered at the carrier; keyword lists left at Twilio
defaults and `JOIN`/`SUBSCRIBE` intentionally NOT added (the CRM owns marketing
opt-in via `detectMarketingJoin`). Inbound + status webhooks point at
`/api/webhook/twilio-inbound` and `/api/webhook/twilio-status`.

**Remaining / to verify:**

- **Vercel env (load-bearing).** `TWILIO_MESSAGING_SERVICE_SID` must equal the
  MG SID above, or `sendSms` falls back to the raw number and bypasses Advanced
  Opt-Out + the 10DLC campaign (`src/server/comms/sendSms.ts`). Also set
  `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` (the token also gates inbound
  webhook signature verification — without it, STOP/START never reach us).
- **A2P 10DLC.** Campaign "Low Volume Mixed" is in TCR review. Sends fail with
  error 30034 until it clears; no manual step on approval. The CRM already
  explains 30034 in failed-message bubbles (`src/lib/twilio-errors.ts`).
- **Inbound voice — NOT set up.** Only outbound click-to-call is wired
  (`src/server/comms/voice.ts`); there is no inbound voice handling (no IVR,
  voicemail, or call forwarding), so inbound calls hit Twilio's default. The
  HELP auto-reply tells people to *call* `+1 208 567 1893`, so either configure
  inbound voice (forward to a staffed line or a voicemail TwiML) or point HELP
  at a staffed number.
- **Email / SendGrid.** Set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`,
  `SENDGRID_UNSUBSCRIBE_GROUP_ID` (bulk email is refused without the group), and
  configure the Event Webhook -> `/api/webhook/sendgrid` with
  `SENDGRID_WEBHOOK_PUBLIC_KEY`. Re-enabling email in the CRM only clears the
  local flag; a contact who used an email unsubscribe link stays suppressed in
  SendGrid until removed from the suppression group (the next send is dropped and
  the `dropped` event self-heals `email_unsubscribed_at`).
- **Two-way email (inbox).** Outbound 1:1 email sends from the inbox composer
  (channel toggle) via `sendDirectEmail` (`src/server/comms/sendEmail.ts`); it
  works as soon as `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL` are set (otherwise
  mock-logged, like SMS). To RECEIVE replies into the inbox:
  1. Pick an inbound subdomain and set `INBOUND_EMAIL_DOMAIN` (e.g.
     `reply.ms.church`). Outbound mail then carries
     `Reply-To: reply+<contactId>@<that domain>`.
  2. In Vercel DNS, add an `MX` record on that subdomain pointing to
     `mx.sendgrid.net` (priority 10).
  3. In SendGrid, add the subdomain under **Settings → Inbound Parse** with the
     destination URL `<APP_BASE_URL>/api/webhook/sendgrid-inbound?token=<SENDGRID_INBOUND_TOKEN>`.
  4. Set `SENDGRID_INBOUND_TOKEN` to a long random secret (the webhook is
     unsigned, so this URL token is its auth — `src/server/webhooks/verify.ts`).
  Replies thread back by the `reply+<contactId>` token, falling back to the
  sender's email (auto-creating a contact, exactly like inbound SMS). Until DNS +
  Parse are live, sending works and receiving stays dormant. Inbound HTML is
  stored in `messages.body_html` but the inbox renders the plain-text `body`
  only (no sanitizer yet — sanitize before ever rendering the HTML).

## 14. Future phases (do NOT build yet)

- v2: ONE high-leverage integration — Meta Lead Ads → CRM, or Google
  Business Profile.
- v3: heavier — unified social DM/comment inbox; Page posting; Google Ads
  reporting.

These stay in their native dashboards (we do NOT rebuild): creating /
targeting / budgeting ad campaigns on Meta and Google; billing; account
settings.
