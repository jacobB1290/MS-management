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
| Email | Brevo (1:1 transactional + campaign blasts); replies land in Google Workspace and are mirrored back into the CRM via a Gmail-API sync |
| Testing harness | Playwright (visual + multi-viewport screenshots) |
| Cron | Supabase pg_cron (Gmail mirror, campaign worker, heartbeat, knowledge sync) |

**Supabase project:** `nhrgbjkiiqpzwdgsvdrl` (region `us-west-1`). Free tier.

**Non-choices on purpose:** Twilio Conversations API; SendGrid (replaced by
Brevo); Brevo Inbound Parsing (we mirror replies from the Gmail mailbox via the
Gmail API instead); RCS; paid Supabase (until we want backups + warm-up).

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
- `heartbeat` — single row, kept warm by a Supabase pg_cron job (`0035`).
- `events` (added in `0028`, extended in `0036`) — CRM mirror/editor for the
  church Google Calendar that ms.church reads. `gcal_event_id UNIQUE` (sync key),
  a structured CTA (`cta_text`/`cta_url`) plus an optional second
  (`secondary_cta_text`/`secondary_cta_url`), quick facts (`cost`/`ages`/`rsvp_by`),
  the flyer's Drive file id + public URL, `status` (`draft`/`published`/`cancelled`),
  `source` (`crm`/`gcal`). `campaigns.event_id` links a promo campaign to it. The
  CTAs + facts serialize into the calendar event's description as a `[Key: value]`
  tag block that ms.church parses back out and renders in the event detail view
  (see §13.2). Google Calendar is the public source of truth; this table is the
  working copy + CRM metadata.

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
  the in-CRM `email_unsubscribed_at` toggle. Replies are mirrored from Gmail into
  the CRM thread for visibility, but we do NOT auto-act on a STOP keyword in them —
  a human in `support@ms.church` toggles the CRM flag if someone asks off.
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
for the typed view; **`docs/design-system.md` is the full documented contract**
(type ladder, chrome, buttons, fields, editors, motion, voice). Highlights:

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
- **`PageHeader`** — subviews and detail pages. ONE compact centered bar at the
  top edge: a balanced `1fr auto 1fr` grid with the **circular `.btn-icon-circle`
  back button** in the left corner (never a text+arrow link), the title dead
  center at `--text-heading`, actions right, and an optional centered `meta`
  line (badge · date · chips) under the title. **Eyebrow only over dynamic
  titles** ("Event", "Campaign" over user-entered text); a static title that
  self-describes ("Settings", "New campaign") gets no eyebrow — it doesn't earn
  the row. Full chrome contract: `docs/design-system.md`.
- **`DetailScaffold` + the mobile collapsing header (iOS large-title).** On
  phones/tablets every subview header collapses iOS-style: the big title rides in
  a hero at the top of the ONE scroll region and scrolls away, while a slim
  frosted bar (back · inline title · actions) stays pinned at the top edge — the
  inline title cross-fading in behind a progressive backdrop-blur as the hero
  passes under it, so content dissolves under the bar instead of clipping on a
  line. Desktop (md+) is unchanged: the static centered `PageHeader`.
  **`DetailScaffold` is the single source** — pass the header parts once and it
  renders the desktop `PageHeader` and the `MobileCollapsingHeader` from the same
  props, so the two layouts can never drift. Route every subview (detail pages,
  create/edit forms, Settings, Audit) through it; the bespoke contact card uses
  the same `MobileCollapsingHeader` primitive via the scaffold's `collapseHeader`
  slot. List pages keep `PageMasthead`; the inbox owns its own chrome. The motion
  is `[data-collapsed]`-driven CSS transitions (globals.css §Collapsing header) —
  compositor-friendly, reduced-motion lands on the correct end state. Loading
  frames go through `DetailScaffold` too, so the collapsed-at-rest frame is
  pixel-identical and nothing shifts on swap.

**Type tiers (don't invent in-betweens):** page title = `--text-heading`
(Playfair semibold) → section tier = `--text-lead` (`SectionHeading`,
`EditorSection`, `CardTitle`, settings pane headings, empty-state titles) →
operational text = Inter at `--text-body`/`--text-compact`/`--text-small` →
labels = small-caps `--text-label`/`--text-micro` (field labels, table `Th`,
the `.eyebrow` voice). **Italics belong to `.motto` identity phrases only**
(the conformance spec fails anything else). One secondary-text voice:
sentence-case muted sans for every helper/hint/whisper line.

**Line discipline:** a visible line means *structure* (the chrome hairline, a
card edge, a meter track, the preview panel's hairline). Inputs are never
lines — the editor field voice is `.field-quiet`, a softly filled well one
step darker than the canvas whose focus draws a gold line along its base.
Section headings (`SectionHeading`, `EditorSection`) carry a hairline rule
that fades to transparent — it anchors the band without boxing it; only
chrome edges get full-strength rules. On xl the editors' live preview sits in
`PreviewPanel`, a segmented side pane; below xl it folds into the flow on the
recessed `PreviewStage` well.

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
- **Keep the harness sharp — and delegate it.** The harness is never "done":
  every change should leave it both *faster* and catching *more*. Don't sink your
  own effort into test plumbing — hand harness work to a parallel agent (e.g. a
  Sonnet subagent) and just tell it what your change needs covered: the new DOM
  contract (stable hooks like `data-collapsing-header` / `data-collapsed`), the
  states (at rest vs scrolled, mobile vs desktop, reduced-motion end state), the
  viewport matrix, and the failure mode you'd hate to ship. It writes/extends the
  scenarios + conformance assertions and tunes run speed while you build; spawn
  it once the DOM contract is stable so its selectors are real. Speed levers live
  in `scripts/harness` (`HARNESS_PROJECTS` to run a subset, `HARNESS_SKIP_BUILD`
  to reuse a warm build, a deterministic `fonts.ready` settle).
- **Measure the harness across sessions.** The harness keeps a committed,
  append-only ledger of every run — wall-clock time + pass/fail/flaky counts,
  stamped with the git SHA — under `scripts/harness/metrics/`, summarized by
  `npm run harness:metrics`. It's how we see whether speed and reliability are
  improving or regressing over time, and by how much; partial runs are tagged so
  they're never compared against full ones. Wins and regressions are measured,
  not guessed.

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
- **Two-way email — mirrored from Gmail.** Outbound 1:1 email sends from the inbox
  composer via `sendDirectEmail` (`src/server/comms/sendEmail.ts`) — From + Reply-To
  both `support@ms.church` (personal, via `brevoPersonalFrom`) — so a recipient's
  reply lands in **Google Workspace (Gmail)**. The CRM then mirrors that mailbox
  back into the contact threads via a Gmail-API read sync
  (`src/server/email/gmailSync.ts`, on the cron): every inbound reply AND anything
  composed directly in Gmail shows in the thread, matched to existing contacts by
  email, idempotent on `Message-ID`. Gated on `GOOGLE_GMAIL_REFRESH_TOKEN` (the
  support@ mailbox's OWN dedicated OAuth client — `GOOGLE_GMAIL_CLIENT_ID/SECRET`,
  falling back to `GOOGLE_OAUTH_*` — minted `gmail.readonly`); unset → the sync
  no-ops and replies stay in Gmail. Keep the apex `MX` on Google. **Phase 2**
  (built, gated behind `GOOGLE_GMAIL_SEND=1` + a `gmail.send` token) routes 1:1
  *sending* through Gmail too (`src/server/email/gmailSend.ts`) so the whole thread
  lives in one mailbox; it auto-falls back to the Brevo path on any failure.

## 13.2 Events → Google Calendar (ms.church)

Staff create events in the CRM (`/events`) that show up on **ms.church**. The
public site reads the church Google Calendar and renders whatever is on it, so
the CRM **writes to that same calendar** in the exact shape the site already
parses — no website change. Google Calendar is the public source of truth; the
`events` table is the CRM's editing surface + mirror.

- **Single source of the contract:** `src/server/google/eventMapping.ts` (pure,
  dependency-free) is the only place that translates an event ↔ a Google
  Calendar event, mirroring ms.church's own regexes:
  - title → `summary`; flyer → a **public Drive attachment**
    (`supportsAttachments=true`), shown via `lh3.googleusercontent.com/d/<id>=w800`;
    timed events send `dateTime` + `timeZone: America/Boise`, all-day uses
    exclusive `end.date`; `location` → `location`.
  - description → `description` (the human body) followed by a **structured tag
    block** — one `[CTA: text | url]` per button (multiple allowed; only real
    `http(s)` links render), plus `[Cost: …]`, `[Ages: …]`, `[RSVP by: …]`. The
    site strips every tag from the visible body and renders the buttons + a
    labeled facts row in the **event detail view** (the lightbox a card's flyer
    opens). A hand-authored "Label: https://…" or bare URL still becomes a button
    when no `[CTA:]` tag is present (back-compat). The format is a superset of the
    original CTA-only scheme, so events authored before `0036` keep parsing.
  - `npm run verify:events` asserts our output against the site's verbatim
    regexes (CTA + facts + the strip), AND, when the `ms.church` repo is a sibling
    checkout, re-reads its `src/routes/calendar.ts` and asserts those regexes are
    still copied verbatim — the cross-repo drift guard. **Run it after touching
    the mapping.** If ms.church changes how it reads the calendar, update the
    mapping + the site parser + this verifier together.
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

## 13.3 Segmenting services without the API (Claude Code as the model)

The Anthropic API has a hard monthly **org spend limit**; when it's reached every
model call returns `400 "You have reached your specified API usage limits"` until
it resets or is raised in the Console (Billing → Limits) — model choice is
irrelevant, the cap is org-wide. For that window (or any time you'd rather not
spend), a **Claude Code session is the model**: it reads a transcript and produces
the structured segmentation itself, with no metered API call.

- **One source of truth:** the prompt, JSON schema, and boundary-repair pass live
  in the pure `src/server/ai/segmentContract.ts`. Both the live API segmenter
  (`segmentSermon.ts`) and the out-of-band path import it, so output is identical.
- **The tool:** `tsx scripts/segment/pump.ts` (`prompt` | `schema` | `pull` |
  `finalize`) is credential-free — it only formats the prompt and runs the schema
  validation + repair. The session does the DB read/write via the Supabase MCP.
- **Fan out:** spawn one **Opus subagent per designated service** (parallel); each
  queries its transcript via MCP and returns the JSON; the parent finalizes and
  writes. Land full re-segmentations at `review` (human publishes). A title-only
  pass (timestamp-independent) can update `generated_title` on an already-chaptered
  published service in place.
- **Full runbook:** `docs/claude-segment-pump.md` (incl. the timestamped-transcript
  caveat: accurate chapter/song times need `[mm:ss]` cues, which the DB doesn't
  store — re-fetch captions or restrict to a metadata pass).
- **Guardrail:** a failed `force` re-run no longer downgrades a live sermon to
  `failed` (it restores `published`/`review`), so a provider/limit error can't pull
  a good service off ms.church (`runSermonPipeline`, `src/server/sermons/service.ts`).

### 13.3.1 The CRM handoff queue — the preferred "session as model" path (0043)

The ad-hoc flow above (a session pulls captions with yt-dlp, hand-assembles the
prompt, hand-writes the DB) is now superseded by a proper queue. The CRM owns
everything except the model call; the session is reduced to *just segment*. This
also fixed a real quality bug: the ad-hoc yt-dlp VTT parse collapsed YouTube's
rolling word-level cues into one coarse `[mm:ss]` per block, so boundaries
drifted — feeding the session the CRM's own `fetchTranscript` `timestamped`
output (clean per-cue timing, the SAME input the API path uses) removes that.

- **Per-run choice, not a global mode.** The back-catalog picker
  (`/sermons/backfill`) has a **"Hold for Claude Code"** toggle. Off (default) =
  the standard Anthropic-API path, unchanged. On = the pipeline runs detect +
  transcribe, then parks the segmentation for a session. The choice rides the
  `sermon_backfill_queue.hold_for_claude` column, so the server-side drain honors
  it with no CRM instance open. `RunOptions.segmentMode` (`'api'|'session'`, default
  `'api'`) carries it into `runSermonPipeline`.
- **The bus:** `public.segmentation_jobs` (migration 0043). On `segmentMode:'session'`
  the pipeline parks the sermon at status `awaiting_segmentation` and inserts a job
  carrying the COMPLETE prompt — `system_prompt` (= `SYSTEM_PROMPT`), `user_content`
  (= `buildSegmentUserContent(...)`, transcript embedded), `json_schema`, plus
  `duration_sec`. `enqueueSegmentationJob` (`src/server/sermons/segmentQueue.ts`)
  assembles it from `segmentContract`, so the session does zero setup.
- **The session's whole job** (via the Supabase MCP — no CRM login; service-role
  bypasses the default-deny RLS): claim the oldest `pending` row, read
  `system_prompt` + `user_content`, produce JSON matching `json_schema`, write it to
  `result` and set `status='returned'`. It never touches `sermons`. Exact protocol:
  ```sql
  update public.segmentation_jobs set status='claimed', claimed_at=now(),
    claimed_by='claude-code', attempts=attempts+1
  where id = (select id from public.segmentation_jobs where status='pending'
              order by created_at limit 1)
  returning id, system_prompt, user_content, json_schema, duration_sec;
  -- ...session segments, following system_prompt + user_content, matching json_schema...
  update public.segmentation_jobs
    set status='returned', result = $JSON$ {raw model JSON} $JSON$::jsonb, returned_at=now()
  where id = '<job id>';
  ```
  Fan out one Opus subagent per job for a batch; each returns raw JSON for its row.
- **The CRM finishes it:** the `segment-finalize` pg_cron (every 2 min →
  `/api/cron/segment-finalize`, `CRON_SECRET`-gated) calls
  `finalizeReturnedSegmentationJobs`: validate `result`, run the IDENTICAL
  `finalizeSegmentation` boundary-repair the API uses, write the sermon via the
  shared `applySegmentation` (`segmentApply.ts`) → status `review`, mark the job
  `finalized`. A bad result marks that one job `error` and is surfaced; the rest
  proceed. So a session-segmented service is byte-for-byte an API-equivalent run,
  lands ready-for-review within ~2 min of handoff, and a human still publishes.
- **`applySegmentation` is the single writer** shared by the API path and the
  finalize path, so the two can never drift (same reason `segmentContract` is
  shared for the prompt). Don't re-implement the sermon write in either caller.

## 14. Future phases (do NOT build yet)

- v2: ONE high-leverage integration — Meta Lead Ads → CRM, or Google
  Business Profile.
- v3: heavier — unified social DM/comment inbox; Page posting; Google Ads
  reporting.

These stay in their native dashboards (we do NOT rebuild): creating /
targeting / budgeting ad campaigns on Meta and Google; billing; account
settings.
