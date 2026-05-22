import { expect, type Locator, type Page } from "@playwright/test";

export const MASKS: readonly string[] = [
  "[data-dynamic]",
  "[data-testid=\"date-pill\"]",
  "[data-testid=\"relative-time\"]",
  "time[datetime]",
  ".date-pill",
  ".relative-time",
];

export async function gotoAndSettle(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.waitForTimeout(200);
}

export async function screenshotPage(page: Page, name: string): Promise<void> {
  const masks: Locator[] = MASKS.map((selector) => page.locator(selector));
  await expect(page).toHaveScreenshot([`${name}.png`], {
    fullPage: true,
    animations: "disabled",
    mask: masks,
  });
}
