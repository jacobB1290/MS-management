import { expect, test } from "@playwright/test";
import { gotoAndSettle, screenshotPage } from "../helpers";

test("login page renders across viewports", async ({ page }) => {
  await gotoAndSettle(page, "/login");
  await screenshotPage(page, "login");
});

test("root redirects when unauthenticated", async ({ page }) => {
  await gotoAndSettle(page, "/");
  expect(page.url()).toContain("/login");
});
