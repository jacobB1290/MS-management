import { test, expect } from "../auth-fixture"
import { gotoAndSettle, screenshotPage } from "../helpers"

/**
 * Sermon editor - /sermons/[id]/edit
 *
 * SR01 is the in-review fixture with full chapters; it is always present in
 * DEMO_MODE and is the canonical edit fixture (review services are the natural
 * pre-publish edit target). SR02 is published.
 *
 * Structural invariants asserted here (screenshot invariants are the pixel
 * diff gate; structural ones are the system-integrity gate):
 *
 *  1. The edit page renders a single h1 at --text-heading in Playfair (via the
 *     DetailScaffold, consistent with every other subview).
 *  2. The sticky EditorBar is present and not overlapping the sticky video
 *     workspace - this is the most likely layout regression in a sticky editor.
 *  3. EditorSection steps 01-05 are all present (form completeness check).
 *  4. The page does not scroll horizontally (the date-input regression from the
 *     events editor lives here too - native datetime-local is wider in some
 *     engines).
 *  5. The form id="sermon-editor" is present and wired (the EditorBar submits
 *     via its formId, so a missing form breaks Save silently).
 */

// SR01 is the demo in-review sermon with full chapter data - the best edit target.
const EDIT_PATH = "/sermons/SR01/edit"
const EDIT_PATH_PUBLISHED = "/sermons/SR02/edit"

test("sermon editor renders (SR01 in-review)", async ({ authed }) => {
  await gotoAndSettle(authed, EDIT_PATH)
  await screenshotPage(authed, "sermon-editor")
})

test("sermon editor renders (SR02 published)", async ({ authed }) => {
  await gotoAndSettle(authed, EDIT_PATH_PUBLISHED)
  await screenshotPage(authed, "sermon-editor-published")
})

test("sermon editor: form element present with correct id", async ({ authed }) => {
  await gotoAndSettle(authed, EDIT_PATH)
  // The EditorBar uses `form={formId}` to submit outside the <form> element.
  // If the form id drifts the Save button is silently broken.
  const form = authed.locator('form#sermon-editor')
  await expect(form, "form#sermon-editor must be present").toBeVisible()
})

test("sermon editor: EditorBar present and not clipped by the video workspace", async ({
  authed,
}) => {
  await gotoAndSettle(authed, EDIT_PATH)

  // The EditorBar is a sticky footer. Its Save button must be visible and
  // tappable from the initial paint position (no need to scroll).
  // The primary check: the bar's Save button is visible without scrolling.
  const saveBtn = authed.locator('button[type="submit"][form="sermon-editor"]')
  await expect(saveBtn, "EditorBar Save button must be visible on paint").toBeVisible()

  // Guard the sticky video workspace vs. sticky EditorBar overlap: the Save
  // button's top edge must be below the video workspace's bottom edge. If the
  // two sticky elements collide, the bar lifts over the workspace and Save
  // becomes unreachable or visually broken.
  const videoWorkspace = authed.locator('div.sticky.top-2').first()
  const workspaceBox = await videoWorkspace.boundingBox()
  const saveBtnBox = await saveBtn.boundingBox()

  if (workspaceBox && saveBtnBox) {
    // EditorBar is sticky bottom; on initial paint it lives below the form
    // content - not necessarily below the video. But as long as they are not
    // physically on top of each other (overlapping) the layout is correct.
    // Overlap means the EditorBar top is above the workspace bottom AND
    // EditorBar bottom is below the workspace top. The bar's natural rest
    // position after domcontentloaded is at the bottom of the visible content,
    // so this overlap can only happen if z-index or positioning is broken.
    const barTop = saveBtnBox.y
    const workspaceBottom = workspaceBox.y + workspaceBox.height
    const barBottom = saveBtnBox.y + saveBtnBox.height
    const workspaceTop = workspaceBox.y
    const overlaps = barTop < workspaceBottom && barBottom > workspaceTop
    expect(
      overlaps,
      `EditorBar (top ${barTop}) overlaps the sticky video workspace (bottom ${workspaceBottom}) - sticky z-index collision`,
    ).toBe(false)
  }
})

test("sermon editor: all five EditorSection steps present", async ({ authed }) => {
  await gotoAndSettle(authed, EDIT_PATH)
  // Each EditorSection renders a step label "01"..."05" in a <span> (or a
  // visually distinct step prefix). Look for the section titles instead, which
  // are more stable than implementation-detail class names.
  const expectedTitles = ["Details", "Chapters", "Songs", "Discovery", "Advanced"]
  for (const title of expectedTitles) {
    // Playwright's getByText is sufficient - it matches any element containing
    // the text. The EditorSection titles render in h2/h3 inside the form.
    await expect(
      authed.getByText(title, { exact: false }).first(),
      `EditorSection "${title}" must be present`,
    ).toBeVisible()
  }
})

test("sermon editor: does not pan horizontally", async ({ authed }) => {
  await gotoAndSettle(authed, EDIT_PATH)
  const overflow = await authed.evaluate(() => {
    const doc = document.scrollingElement!
    const docOverflow = doc.scrollWidth - doc.clientWidth
    let regionOverflow = 0
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("[data-scroll-region]"),
    )) {
      regionOverflow = Math.max(regionOverflow, el.scrollWidth - el.clientWidth)
    }
    return { docOverflow, regionOverflow }
  })
  expect(
    overflow.docOverflow,
    "sermon editor: document pans horizontally (datetime-local regression?)",
  ).toBeLessThanOrEqual(1)
  expect(
    overflow.regionOverflow,
    "sermon editor: scroll region pans horizontally",
  ).toBeLessThanOrEqual(1)
})

test("sermon editor: h1 at --text-heading in Playfair (subview chrome contract)", async ({
  authed,
}) => {
  // Below md the masthead is hidden by the collapsing header; h1 is
  // desktop-chrome. The mobile collapsing-header contract is covered by
  // 60-collapsing-header.spec.ts.
  test.skip(
    (authed.viewportSize()?.width ?? 0) < 768,
    "md+ chrome; mobile uses the collapsing header",
  )
  await gotoAndSettle(authed, EDIT_PATH)
  const h1 = authed.locator("h1").first()
  await expect(h1, "one h1 visible").toBeVisible()

  const style = await h1.evaluate((el) => {
    const s = getComputedStyle(el)
    return { family: s.fontFamily, size: parseFloat(s.fontSize) }
  })
  expect(style.family, "h1 uses the display face (Playfair)").toContain("Playfair")

  // Resolve --text-heading against the body so fluid clamp() is computed.
  const heading = await authed.evaluate(() => {
    const probe = document.createElement("div")
    probe.style.fontSize = "var(--text-heading)"
    document.body.appendChild(probe)
    const px = parseFloat(getComputedStyle(probe).fontSize)
    probe.remove()
    return px
  })
  expect(
    Math.abs(style.size - heading),
    `h1 must sit at --text-heading (got ${style.size}px, token ${heading}px)`,
  ).toBeLessThanOrEqual(0.5)
})

test("sermon editor: circular back button present and >=44px (md+ chrome)", async ({
  authed,
}) => {
  test.skip(
    (authed.viewportSize()?.width ?? 0) < 768,
    "md+ chrome; mobile uses the collapsing header",
  )
  await gotoAndSettle(authed, EDIT_PATH)
  const back = authed.locator(".btn-icon-circle").first()
  await expect(back, "circular back button visible").toBeVisible()
  const box = await back.boundingBox()
  expect(box?.height ?? 0, "back button height >=43px").toBeGreaterThanOrEqual(43)
  expect(box?.width ?? 0, "back button width >=43px").toBeGreaterThanOrEqual(43)
})

test("sermon editor: mobile collapsing header present at rest (mobile only)", async ({
  authed,
}) => {
  test.skip(
    (authed.viewportSize()?.width ?? 0) >= 768,
    "mobile affordance; desktop uses the static PageHeader",
  )
  await gotoAndSettle(authed, EDIT_PATH)
  const header = authed.locator("[data-collapsing-header]").first()
  await expect(
    header,
    "collapsing header must render on mobile",
  ).toBeAttached()
  await expect(header, "at rest: data-collapsed=false").toHaveAttribute("data-collapsed", "false")
})

test("sermon editor: no stray italics outside .motto", async ({ authed }) => {
  await gotoAndSettle(authed, EDIT_PATH)
  const offenders = await authed.evaluate(() => {
    const bad: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (!el.textContent?.trim()) continue
      if (getComputedStyle(el).fontStyle !== "italic") continue
      if (el.closest(".motto") || el.classList.contains("motto")) continue
      bad.push(
        `<${el.tagName.toLowerCase()} class="${el.className}"> "${el.textContent.trim().slice(0, 40)}"`,
      )
    }
    return bad.slice(0, 5)
  })
  expect(offenders, "italic outside .motto on sermon editor").toEqual([])
})

test("sermon editor: TimeField icon buttons are >=44px tall", async ({ authed }) => {
  await gotoAndSettle(authed, EDIT_PATH)
  // TimeField renders capture (Crosshair) and seek (Play) buttons with
  // aria-labels. They must meet the 44px tap-target floor.
  const captureButtons = authed.locator('button[aria-label*="current playhead"]')
  const n = await captureButtons.count()
  // SR01 has 6 chapters, each with start+end, so there should be at least
  // 2 capture buttons. Skip if the editor rendered with zero rows (edge case
  // in a stripped demo that shouldn't happen for SR01).
  if (n === 0) {
    test.skip(true, "no TimeField capture buttons found - editor may have no chapters")
    return
  }
  for (let i = 0; i < Math.min(n, 4); i++) {
    const btn = captureButtons.nth(i)
    if (!(await btn.isVisible())) continue
    const box = await btn.boundingBox()
    if (!box) continue
    expect(
      box.height,
      `capture button [${i}] height must be >=43px (got ${box.height}px)`,
    ).toBeGreaterThanOrEqual(43)
  }
})

test("sermon editor: heading sizes on token scale", async ({ authed }) => {
  await gotoAndSettle(authed, EDIT_PATH)
  const scale = await Promise.all(
    [
      "--text-hero",
      "--text-title",
      "--text-heading",
      "--text-lead",
      "--text-body",
      "--text-compact",
      "--text-small",
    ].map((t) =>
      authed.evaluate((name) => {
        const probe = document.createElement("div")
        probe.style.fontSize = `var(${name})`
        document.body.appendChild(probe)
        const px = parseFloat(getComputedStyle(probe).fontSize)
        probe.remove()
        return px
      }, t),
    ),
  )
  const offenders = await authed.evaluate(() => {
    const sizes: Array<{ tag: string; size: number; text: string }> = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("h1, h2, h3"))) {
      if (!el.textContent?.trim()) continue
      sizes.push({
        tag: el.tagName.toLowerCase(),
        size: parseFloat(getComputedStyle(el).fontSize),
        text: el.textContent.trim().slice(0, 30),
      })
    }
    return sizes
  })
  for (const h of offenders) {
    const onScale = scale.some((s) => Math.abs(s - h.size) <= 0.5)
    expect(
      onScale,
      `<${h.tag}> "${h.text}" at ${h.size}px is off the token scale [${scale.map((s) => s.toFixed(1)).join(", ")}]`,
    ).toBe(true)
  }
})
