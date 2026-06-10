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
| Email | Brevo (Transactional API for 1:1; Marketing Campaign API for blasts). Replies handled in Google Workspace, not the CRM |
| Testing harness | Playwright (visual + multi-viewport screenshots) |
| Cron | GitHub Actions (heartbeat) |

**Supabase project:** `nhrgbjkiiqpzwdgsvdrl` (region `us-west-1`). Free tier.

**Non-choices on purpose:** Twilio Conversations API; SendGrid (replaced by
Brevo); Brevo Inbound Parsing (replies go to Google Workspace, not the CRM);
RCS; paid Supabase (until we want backups + warm-up).

## 3. Architecture — four layers, hard wall between them

1. **Operator UI** (Next.js). Never holds privileged keys. All privileged
   actions call a server endpoint or an Edge Function.
2. **Server endpoints** (Route Handlers / Edge Functions). Only place that
   touches Twilio/Brevo secrets and the service-role Supabase key.
3. **Database** (Supabase Postgres). RLS on every table, default-deny.
4. **Pipes** (Twilio, Brevo). Dumb send/receive. Never trusted as a
   source of identity — authenticate their webhooks (Twilio signs; Brevo does
   not, so it is gated on a shared URL token).

**Hard rule:** the browser never sees the service-role key, the Twilio auth
token, or the Brevo API key. Every send, every privileged DB write goes
through a server-side path.

## 4. Data model

Six core tables + three supporting. See `supabase/migrations/0001_init.sql`.

- `contacts` — name, phone (E.164, `CHECK ~ '^\+[1-9]\d{1,14}$'`, `UNIQUE`),
  email (citext), tags (text[], GIN), language (en/ru), `sms_opted_out_at`,
  `email_unsubscribed_at`, `consent_method`, `consent_at`, notes.
  - **Single source of truth for opt-out: `*_opted_out_at TIMESTAMPTZ NULL`.**
    `NULL` means opted in. No separate boolean.
  - Denormalized inbox summary (added in `0030`): `last_message_*` +
    `message_count`, maintained by a trigger on `messages` — never write them
    directly. `contact_summary` is a thin view over these; the inbox orders by
    the partial index on `last_message_at`.
- `messages` — direction, body, media_url, channel (sms/mms),
  `twilio_sid UNIQUE` (idempotency), status, error, campaign_id, sent_by.
- `campaigns` — channel (sms/email), body (SMS) or `brevo_template_id` (email),
  audience_filter (jsonb), status state machine. Email blasts also store
  `brevo_campaign_id` / `brevo_list_id` / `stats`.
- `campaign_recipients` — composite PK, per-recipient status incl.
  `skipped_opt_out` and `skipped_unsubscribed`. `claimed_at` stamps a worker
  claim; `claim_campaign_batch` re-claims `sending` rows stuck >10 min, so a
  crashed batch re-sends (at-least-once) instead of wedging the campaign.
- `email_events` — `provider_event_id UNIQUE` (idempotency; Brevo emits no
  per-event id, so the webhook synthesizes one); trigger auto-syncs
  unsubscribe/spam/hard_bounce back to `contacts.email_unsubscribed_at`.
- `form_submissions` — immutable proof-of-opt-in.
- `app_users` — `auth.users.id` → role (`admin` | `member`).
- `audit_log` — write-only privileged action log.
- `heartbeat` — single row, kept warm by GH Actions cron.
- `events` (added in `0028`) — CRM mirror/editor for the church Google Calendar
  that ms.church reads. `gcal_event_id UNIQUE` (sync key), structured CTA
  (`cta_text`/`cta_url`), the flyer's Drive file id + public URL, `status`
  (`draft`/`published`/`cancelled`), `source` (`crm`/`gcal`). `campaigns.event_id`
  links a promo campaign to it. Google Calendar is the public source of truth;
  this table is the working copy + CRM metadata. See §13.2.

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
3. **Webhook authentication before any DB write.** Twilio:
   `X-Twilio-Signature` HMAC-SHA1 over URL + sorted params. Brevo does NOT sign
   webhooks, so it is gated on a secret URL token (`BREVO_WEBHOOK_TOKEN`,
   constant-time compared). Reject anything that doesn't validate.
4. **Phone normalization to E.164 on every entry point.** Use
   `src/server/validation/phone.ts`. The DB CHECK is a safety net, not the
   primary gate.
5. **Idempotency.** `messages.twilio_sid` and `email_events.provider_event_id`
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
- **Email unsubscribe (CAN-SPAM).** Bulk blasts go out through Brevo's campaign
  lane, which auto-includes a working unsubscribe link + hosts the unsubscribe
  page; the physical mailing address (`PHYSICAL_MAILING_ADDRESS`) goes in the
  Brevo template footer. Brevo's marketing webhook (`/api/webhook/brevo`) mirrors
  `unsubscribe`/`spam`/`hard_bounce` back to `contacts.email_unsubscribed_at`.
  1:1 inbox email (`sendDirectEmail`) is a true personal reply via Brevo's
  transactional API and deliberately carries NO List-Unsubscribe header — that
  header brands a message as a mailing list, which is wrong for a 1:1 and hurts
  the relationship. Opt-out is enforced by `assertCanSendEmail` (the wall) and
  the in-CRM `email_unsubscribed_at` toggle. Replies are NOT ingested into the
  CRM — they go to `support@ms.church` in Gmail — so there is no inbound
  STOP-keyword handler; a human there toggles the CRM flag if someone asks off.
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
- **Campaign/bulk email** is **commercial** → it ships through Brevo's campaign
  lane, which **requires** a verified sender and auto-includes the unsubscribe
  link; the postal address lives in the template footer. The send path also
  enforces the free-tier daily send cap (`BREVO_DAILY_SEND_CAP`).

**Responsibility split:**

| Concern | CRM | Brevo (the email pipe) |
|---|---|---|
| Source of truth for opt-out | `contacts.email_unsubscribed_at` (`NULL` = subscribed); `assertCanSendEmail` is the wall | `emailBlacklisted` on the contact — drops a send even if our flag is stale |
| Consent record | `consent_method` / `consent_at` | — |
| Catch a reply that says "stop" | a human in `support@ms.church` (Gmail) toggles `email_unsubscribed_at` in the CRM | — (replies are not ingested) |
| Unsubscribe link / one-click | none in app code | bulk: Brevo auto-includes + hosts the unsubscribe link. 1:1: none (personal reply) |
| Bounce / spam / unsub events | `email_events` trigger mirrors back to the flag | marketing webhook (`/api/webhook/brevo`) posts `unsubscribe`/`spam`/`hard_bounce` |

Re-enabling email in the CRM only clears the **local** flag; a contact who used
a Brevo unsubscribe link stays `emailBlacklisted` in Brevo until removed there
(Brevo won't deliver to them, and the next unsubscribe/bounce event re-heals our
flag).

**External setup needed:** Brevo account + API key; a verified sender; domain
auth (SPF/DKIM/DMARC via Brevo) for deliverability — without it Brevo rewrites
the From to `@brevosend.com`; the postal address in the template footer; and the
marketing webhook (`/api/webhook/brevo?token=…`). Full steps + the SendGrid
teardown live in `docs/brevo-email-setup-runbook.md`. Heads-up: this is the
US/CAN-SPAM model — **CASL (Canada) / GDPR (EU) are opt-IN**; if the church
emails international contacts, revisit. Not legal advice — confirm with counsel.

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

### 7.1 Console chrome system (load-bearing — the harness enforces it)

One header system, two components, no bespoke page chrome:

- **`PageMasthead`** — the four primary tabs (Contacts / Events / Campaigns;
  Inbox's rail owns its own chrome). Compact: title at **`--text-heading`**
  (this is product chrome, one tier below the marketing `--text-title`),
  one-line description, `actions` top-right (primary `.btn-icon-action` circle
  in the outermost corner on every page), optional `toolbar` row. Hidden below
  `md` (the mobile topbar names the page); on mobile the toolbar+actions share
  one 44px band. The masthead owns its hairline + padding — never wrap it in
  another bordered div.
- **`PageHeader`** — subviews and detail pages (back affordance, optional
  actions/info). Same `--text-heading` title tier. **Eyebrow only over dynamic
  titles** ("Event", "Campaign" over user-entered text); a static title that
  self-describes ("Settings", "New campaign") gets no eyebrow — it doesn't earn
  the row.

**Type tiers (don't invent in-betweens):** page title = `--text-heading`
(Playfair semibold) → section tier = `--text-lead` (`SectionHeading`,
`EditorSection`, `CardTitle`, settings pane headings, empty-state titles) →
operational text = Inter at `--text-body`/`--text-compact`/`--text-small` →
labels = small-caps `--text-label`/`--text-micro` (field labels, table `Th`,
the `.eyebrow` voice). **Italics belong to `.motto` identity phrases only**
(the conformance spec fails anything else). One secondary-text voice:
sentence-case muted sans for every helper/hint/whisper line.

**Line discipline:** a visible line means *structure* (the chrome hairline, a
card edge, a meter track). Inputs are never lines — the editor field voice is
`.field-quiet`, a softly filled well one step darker than the canvas whose
focus draws a gold line along its base. Sections separate by whitespace +
their serif heading, not by rules.

**Layout:** every page sits in `PAGE_GUTTER` (exported from `page-scaffold`) —
the conformance spec asserts the tabs' titles align to the pixel. Tables go
through `TableCard`/`Table`/`Th`/`Tr`/`Td`; rows hover with the standard
surface tint.

**Loading is designed, not incidental:** every route has a `loading.tsx`
composed from `src/components/ui/loading-blocks.tsx`, rendering the page's
REAL masthead/header (so the frame is pixel-identical and nothing shifts on
swap) with `LoadingView`-wrapped ghosts for the data region. A new route
without a loading state is a perf regression — navigation must paint
instantly. (Deliberate exception: no `loading.tsx` under `/inbox` — it would
break the hold-previous-thread behavior; the rail streams via the layout's
Suspense slot instead.)

**Enforcement:** `scripts/harness/scenarios/50-conformance.spec.ts` asserts
the invariants above (single h1 at the right tier, shared gutters, no stray
italics, 44px tap targets, headings on the token scale) across the viewport
matrix. Run it with the harness; when you add a system rule, add its
assertion there too — the conformance spec is what keeps delegated or
lower-effort work from quietly eroding the system.

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
- `BREVO_API_KEY`, `BREVO_FROM_EMAIL`, `BREVO_FROM_NAME`,
  `BREVO_REPLY_TO_EMAIL`, `BREVO_WEBHOOK_TOKEN`
- `PUBLIC_FORM_HMAC_SECRET` (HMAC the public website uses when posting
  form submissions to this app)
- `APP_BASE_URL`, `PHYSICAL_MAILING_ADDRESS`

Twilio + Brevo creds can be empty during early UI development — the send
functions degrade to a logged-only mode so the inbox can be built and the
harness can run without provisioning a real Twilio number or Brevo account first.

## 13. Build sequence (per project brief §9)

1. Schema + migrations ✅
2. Twilio number + 10DLC registration (external, runs in background)
3. Inbound SMS webhook + outbound 1:1 send (the MVP)
4. Contacts UI + public website form receiver
5. Batch SMS via Messaging Service + central opt-out enforcement
6. Email via Brevo (blasts: campaign API by template id + marketing webhook;
   1:1 inbox email: `sendDirectEmail` via the transactional API; replies handled
   in Google Workspace, not ingested)
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
- **Email / Brevo.** Set `BREVO_API_KEY`, `BREVO_FROM_EMAIL`, `BREVO_FROM_NAME`,
  `BREVO_REPLY_TO_EMAIL` (= `support@ms.church`). Authenticate the `ms.church`
  domain in Brevo (SPF/DKIM/DMARC) or Brevo rewrites the From to `@brevosend.com`.
  Register the marketing webhook (events `unsubscribed`/`hardBounce`/`spam`) at
  `<APP_BASE_URL>/api/webhook/brevo?token=<BREVO_WEBHOOK_TOKEN>`; Brevo does not
  sign webhooks, so that URL token is the auth. Bulk blasts hand a per-campaign
  LIST to Brevo (never a per-recipient transactional loop) and respect the free
  tier's 300/day shared cap via `BREVO_DAILY_SEND_CAP`. Full provisioning + the
  SendGrid teardown: `docs/brevo-email-setup-runbook.md`.
- **Two-way email — by design, NOT ingested.** Outbound 1:1 email sends from the
  inbox composer (channel toggle) via `sendDirectEmail` (`src/server/comms/sendEmail.ts`),
  working as soon as `BREVO_API_KEY` + `BREVO_FROM_EMAIL` are set (otherwise
  mock-logged, like SMS). Outgoing mail carries `Reply-To: support@ms.church`, so
  a recipient's reply lands in **Google Workspace (Gmail)** where a human answers
  it — replies are deliberately NOT parsed back into the CRM (Brevo Inbound
  Parsing is out of scope; the deferred path is in the email spec's Appendix A).
  Keep the root `MX` on Google.

## 13.2 Events → Google Calendar (ms.church)

Staff create events in the CRM (`/events`) that show up on **ms.church**. The
public site reads the church Google Calendar and renders whatever is on it, so
the CRM **writes to that same calendar** in the exact shape the site already
parses — no website change. Google Calendar is the public source of truth; the
`events` table is the CRM's editing surface + mirror.

- **Single source of the contract:** `src/server/google/eventMapping.ts` (pure,
  dependency-free) is the only place that translates an event ↔ a Google
  Calendar event, mirroring ms.church's own regexes:
  - title → `summary`; description → `description` with a `[CTA: text | url]`
    tag appended (the site strips it and renders it as the flyer button — only
    for real `http(s)` links); flyer → a **public Drive attachment**
    (`supportsAttachments=true`), shown via `lh3.googleusercontent.com/d/<id>=w800`;
    timed events send `dateTime` + `timeZone: America/Boise`, all-day uses
    exclusive `end.date`.
  - `npm run verify:events` asserts our output against the site's verbatim
    regexes. **Run it after touching the mapping.** If ms.church changes how it
    reads the calendar, update the mapping + this verifier together.
- **Auth + degrade-to-mock (like Twilio/Brevo):** `src/server/google/auth.ts`.
  Reads work with `GOOGLE_CALENDAR_API_KEY` *or* OAuth; writes (events + Drive
  uploads) need an OAuth refresh token for the church account
  (`GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN`, scopes `calendar` +
  `drive.file`). No creds → mock mode: events save locally, Publish/Sync are
  logged no-ops. Setup + the load-bearing gotcha (publish the OAuth app to
  **Production** or the refresh token dies in 7 days) live in
  `docs/events-google-setup-runbook.md`.
- **Two-way:** Publish pushes a CRM event to the calendar; Sync pulls events
  authored directly in Calendar into the table and reconciles status. Service
  logic: `src/server/events/service.ts`; routes under `src/app/api/events/`.
- **Image flow:** the flyer is uploaded to the CRM's `mms-media` bucket (the
  editor preview + MMS/email promo use that URL), then copied to Drive and shared
  publicly on publish — that Drive copy is what the public site shows.
- **Campaigns + consent:** "Promote" opens the campaign composer pre-filled from
  the event (SMS body + flyer as MMS, or email subject) and links it via
  `campaigns.event_id`. The promo is **marketing**, so it goes through the
  existing wall unchanged — SMS requires `marketing_consent_at` + not opted out;
  bulk email goes through Brevo's campaign lane with its hosted unsubscribe +
  footer postal address (see §6/§6.1). No
  new send path; consent timing is enforced exactly as for any campaign.
- **Promote with AI (Opus):** "Promote" sends the operator to the composer with
  `?ai=1`, which calls `POST /api/events/[id]/promote` →
  `src/server/events/promote.ts`. Opus reads the **flyer image** (multimodal)
  plus the event details and the real audience (tag counts, member/eligibility
  totals) and returns a structured plan — channel, message, optimal audience,
  and send timing — that fills the composer; the operator reviews and sends, and
  the consent wall still gates the actual send. It's a registered AI feature
  (`promote` in `src/lib/ai-models.ts`, default Opus/high, switchable in
  Settings → AI models) using the same `output_config.format` json_schema +
  `isAiEnabled`/`getFeatureConfig` pattern as the rest of `src/server/ai/`; no
  `ANTHROPIC_API_KEY` → 503 and the composer falls back to the static pre-fill.
- **Care:** don't publish throwaway future-dated test events on the live
  calendar — they appear publicly within ~5 minutes. Use mock mode or a separate
  `GOOGLE_CALENDAR_ID` while testing.

## 14. Future phases (do NOT build yet)

- v2: ONE high-leverage integration — Meta Lead Ads → CRM, or Google
  Business Profile.
- v3: heavier — unified social DM/comment inbox; Page posting; Google Ads
  reporting.

These stay in their native dashboards (we do NOT rebuild): creating /
targeting / budgeting ad campaigns on Meta and Google; billing; account
settings.
