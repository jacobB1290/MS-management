# MS Management design system

The working reference for every screen in the console. CLAUDE.md §7 carries the
short, load-bearing version; this file is the full contract. If a screen and
this document disagree, one of them is a bug — fix whichever drifted.

The console shares its visual language with ms.church (warm cream, gold,
Playfair + Inter) but it is a *product*, not a marketing page: chrome is
compact, signals beat explanations, and every rule below exists to let a
first-time staff member land on a page and just know what to do.

---

## 1. The type ladder

Six rungs. Every piece of text on every screen sits on exactly one of them.
Don't invent in-betweens; if a design wants a seventh rung, the design is
wrong.

| Rung | Token · face | Used for | Never used for |
|---|---|---|---|
| **Document headline** | `--text-title` · Playfair semibold | The thing being authored, *inside* an editor: the event title input, the campaign name input | Page chrome, section heads |
| **Page title** | `--text-heading` · Playfair semibold | The single `h1` in the chrome: masthead titles, subpage header titles | Anything inside the page body |
| **Section** | `--text-lead` · Playfair | `EditorSection` / `SectionHeading` / `CardTitle` / settings pane heads / empty-state titles | Field labels, helper text |
| **Operational** | `--text-body` / `--text-compact` / `--text-small` · Inter | Everything you read and act on: table cells, inputs, buttons, helper lines | Headings |
| **Label** | `--text-label` / `--text-micro` · Inter semibold small-caps | Field labels (`FormField` quiet), table `Th`, status flags | Sentences, hints |
| **Eyebrow** | `--text-eyebrow` · Inter semibold small-caps wide | The `.eyebrow` voice: rail labels ("What they'll see"), the overline above a dynamic page title | Anything longer than ~3 words |

Rules that keep the ladder honest:

- **One headline per surface.** The page chrome owns `--text-heading`; an
  editor's hero input owns `--text-title`. They never compete — chrome is
  smaller than the document, which is the point.
- **A label never sits directly above a serif headline-sized input.** The big
  serif well at the top of an editor IS its own label (placeholder names it,
  `sr-only` label keeps it accessible). The small-caps voice starts at the
  fields *inside* sections.
- **Italics belong to `.motto` identity phrases only.** The conformance spec
  fails anything else.
- **One secondary-text voice:** sentence-case muted sans (`text-small
  text-ink-muted`) for every helper/hint/whisper. Hints are rationed — one
  quiet sentence per section (`EditorSection` `note`), not a crumb under every
  field. If a field needs explaining, first try renaming the field.

## 2. Console chrome — two headers, no bespoke variants

### `PageMasthead` — the four primary tabs

Compact left-aligned band: title at `--text-heading`, one-line description,
actions top-right (the primary `.btn-icon-action` gold circle in the outermost
corner on every page), optional toolbar row. Hidden below `md` (the mobile
topbar names the page). Owns its hairline + padding.

### `PageHeader` — every subpage and detail view

One compact centered bar at the top edge:

```
┌──────────────────────────────────────────────────┐
│ (←)            EYEBROW                    actions │
│                Title ⓘ                            │
│         badge · meta · linked chips               │  ← optional `meta` line
└───────────────────── hairline ───────────────────┘
```

- md+ is a balanced `1fr auto 1fr` row, so the title is a *true* center
  regardless of how wide the action cluster is. Long titles truncate.
- Below md the title earns the full width instead of being squeezed between
  the corners: back + actions share the utility row, the centered title block
  sits on its own line beneath, meta under that.
- **Back is always the circular `.btn-icon-circle` button** in the left
  corner — never a text-plus-arrow link. `backMobileOnly` keeps it off
  desktop for pages the sidebar already exits (Settings, Audit).
- **Eyebrow only over dynamic titles** ("Event", "Campaign" over user-entered
  text). A static title that self-describes ("Settings", "New campaign") gets
  no eyebrow.
- Status lives in the centered `meta` line (badge · date · linked chips), one
  line, small pieces. Never stack paragraphs in the header.
- The header owns its hairline + padding; never wrap it in another bordered
  div. Total height stays around one 44px row (+ the meta line when present).

Every route renders this same frame in its `loading.tsx` (real header,
`Skeleton` title/meta) so nothing shifts on swap.

## 3. Buttons — four shapes, fixed meanings

| Shape | Class / component | Meaning |
|---|---|---|
| Gold gradient pill | `.btn-cta` (+ `--secondary`, `--danger`) | THE call to action of a surface |
| Solid gold circle | `.btn-icon-action` | A page's single primary icon action (the "+" in mastheads) |
| Quiet white circle | `.btn-icon-circle` | Chrome navigation: the back button, secondary circular controls |
| Tinted gold circle | `.btn-icon-soft` | Quick-action rows (Message / Call / Email / Edit) |

One gold circle per page. If two things both want to be the gold circle,
one of them is secondary — give it the quiet circle or a text button.

## 4. Fields — the quiet well

The editor field voice is `.field-quiet`: a softly filled well one step darker
than the canvas; focus draws a gold line along its base. **Inputs are never
lines** — on these surfaces a line means structure (hairline, card edge, meter
track) and a fill means "type here." The two vocabularies never mix.

- Labels: small-caps `--text-micro`, warming to gold while the field has
  focus (`FormField variant="quiet"`).
- Optionality is whispered in the label (`End date · optional`), not in a
  hint sentence.
- Toggles are the shared `Switch` — a 24px gold track inside a 44px hit area,
  thumb anchored and gliding, never snapping, never escaping the pill. A
  binary that belongs to a whole section rides in the section header's
  `aside` slot (e.g. "All day" on When & where), not as a lone row.

## 5. Composition surfaces (editors)

The event editor and campaign composer follow one shape, so learning one
teaches the other:

1. **Hero well** — the document headline input (`--text-title`, serif),
   placeholder naming the act ("Name your event", "Name your campaign").
2. **Numbered steps** — `EditorSection` with gold serif numerals `01 02 03`.
   The numbers are the wayfinding: a first-time user sees the stages at a
   glance. Each heading carries the fading rule (see §6), so the steps scan
   as bands without boxing the fields in.
3. **The preview side panel** — what the public/recipient sees (site card,
   recipient phone) lives in `PreviewPanel` on `xl`: a vertical hairline and
   faintly tinted plane bleeding to the right screen edge, so the exhibit is
   segmented from the configurator instead of floating in its corner. Below
   `xl` the preview folds into the flow on its recessed `PreviewStage` well.
4. **No dead cream** — the form column centers itself between the sidebar and
   the preview panel; neither side strands a gulf of empty canvas.
5. **EditorBar** — the sticky closing bar: whisper on the left ("Saves as a
   draft. Nothing sends until you confirm it."), Cancel + primary on the
   right. The whisper is where reassurance lives, so the body doesn't need
   disclaimers.

## 6. Lines, surfaces, spacing

- A visible line means *structure*: the chrome hairline, a card edge, a meter
  track, the preview panel's hairline. Never decoration, never an input.
- **Section rules fade.** The hairline that runs from a section heading
  (`SectionHeading`, `EditorSection`) dissolves to transparent — it anchors
  the heading and separates the band without drawing a box. Full-strength
  rules belong to chrome edges only.
- Flush by default, cards by exception, never nested cards.
- Spacing comes from the t-shirt tokens (`--space-xs` … `--space-3xl`), all
  fluid. Within ~30% of a token, use the token.
- Every page body sits in `PAGE_GUTTER`; the conformance spec asserts the
  tabs align to the pixel.

## 7. Motion

Every action animates; a hard state jump is a defect. The floor is "it
animates"; the bar is "smooth and tasteful."

- Token tiers only: `--motion-fast` (0.2s) for color/hover, `--motion-medium`
  (0.3s) for movement/reveal, with `--ease-standard` / `--ease-out-soft`.
- Conditional affordances reserve space and fade/slide (the
  `grid-rows-[0fr→1fr]` reveal), never pop in and shove the layout.
- Swapping text settles in (`settings-pane-in`); values never hard-cut.
- `prefers-reduced-motion` scales motion down (`motion-reduce:transition-none`
  on every transition) — it never excuses skipping motion elsewhere.

## 8. Voice

- Sentence case everywhere. Trailing periods belong to editorial copy
  (marketing site, emails); product chrome (buttons, table headers, modal
  titles, toasts, page titles) drops them.
- Curly quotes in visible copy; no em dashes in visible copy; numbers speak
  in people ("Reaching up to 12 people"), not filters.
- Explanation budget: the chrome ⓘ popover holds the long story; the page
  itself gets at most one whisper per section. Good signals beat captions.

## 9. Enforcement

`scripts/harness/scenarios/50-conformance.spec.ts` asserts the invariants
mechanically across the viewport matrix: single `h1` at the right tier,
shared gutters, centered subpage titles, circular ≥44px back buttons, no
stray italics, headings on the token scale. **When you add a system rule,
add its assertion there too.**
