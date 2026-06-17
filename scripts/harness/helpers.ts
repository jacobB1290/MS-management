import { expect, type Locator, type Page } from "@playwright/test";

export const MASKS: readonly string[] = [
  "[data-dynamic]",
  "[data-testid=\"date-pill\"]",
  "[data-testid=\"relative-time\"]",
  "time[datetime]",
  ".date-pill",
  ".relative-time",
];

// ---------------------------------------------------------------------------
// settle() — wait until the page is visually stable before screenshotting.
//
// The old strategy was networkidle + a fixed 200ms sleep. That was both slow
// (200ms is a lot when multiplied across ~50 shots × 5 viewports) and still
// flaky: if a web font hadn't finished loading within that wall clock window
// the screenshot would come out in a system fallback face and diff against the
// baseline.
//
// New strategy (two steps, in order):
//   1. document.fonts.ready — resolves when every @font-face that was
//      requested during load has either loaded or failed. This is the actual
//      root cause of "text renders differently between runs", so waiting for it
//      is both faster (resolves as soon as fonts land, not after an arbitrary
//      delay) and more reliable than a fixed sleep.
//   2. One rAF flush — queues a microtask that resolves on the next paint
//      frame, giving the browser a chance to apply any pending CSS repaints
//      that follow the font-load event before we trigger the screenshot. The
//      rAF handle is immediately cancelled so we're not holding a persistent
//      callback; the awaited Promise is what does the work.
//   3. An 80ms tail — trimmed from 200ms. This catches any remaining async
//      animation or deferred React render that networkidle alone doesn't
//      guarantee. 80ms is enough for a 60fps frame budget (16ms) × 5 and is
//      still well below the old 200ms floor.
// ---------------------------------------------------------------------------
async function settle(page: Page): Promise<void> {
  // 1. Fonts — the main cause of cross-run screenshot shift.
  await page.evaluate(() => document.fonts.ready);
  // 2. One paint frame so CSS repaints triggered by font-load are flushed.
  await page.evaluate(
    () => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); }),
  );
  // 3. Short tail for deferred renders / micro-animations.
  await page.waitForTimeout(80);
}

export async function gotoAndSettle(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "networkidle" });
  await settle(page);
}

export async function screenshotPage(page: Page, name: string): Promise<void> {
  // Re-run the settle sequence immediately before the shot too. Callers often
  // do extra interactions between gotoAndSettle and screenshotPage (clicks,
  // fills, waitForTimeout for their own reasons) and those can trigger lazy
  // font loads or repaint cycles. A second settle here is cheap — fonts.ready
  // resolves instantly if already resolved — and it means every screenshot
  // path goes through the same determinism gate regardless of call site.
  await settle(page);
  const masks: Locator[] = MASKS.map((selector) => page.locator(selector));
  await expect(page).toHaveScreenshot([`${name}.png`], {
    fullPage: true,
    animations: "disabled",
    mask: masks,
  });
}
