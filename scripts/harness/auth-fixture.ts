/* eslint-disable react-hooks/rules-of-hooks -- Playwright `use` is not a React hook */
import { test as base, type Page } from "@playwright/test"

/**
 * Auth fixture for the harness. The harness boots the app in DEMO_MODE (see the
 * webServer env in playwright.config.ts), where there is no Supabase and a single
 * cookie stands in for the session. We drop that cookie directly so every
 * scenario renders the in-memory fixtures as the seeded demo admin — no real
 * project, secrets, or seeded users required. The cookie name mirrors
 * DEMO_COOKIE in src/server/demo; it lives in a server-only module, so it is
 * inlined here rather than imported.
 */
export const test = base.extend<{ authed: Page }>({
  authed: async ({ page, baseURL }, use) => {
    await page.context().addCookies([
      {
        name: "ms_demo",
        value: "1",
        url: baseURL ?? "http://localhost:3000",
        sameSite: "Lax",
      },
    ])
    await use(page)
  },
})

export { expect } from "@playwright/test"
