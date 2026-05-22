/* eslint-disable react-hooks/rules-of-hooks -- Playwright `use` is not a React hook */
import { test as base, type Page } from "@playwright/test"

/**
 * Auth fixture for the harness. Calls /api/dev/sign-in (NODE_ENV !== production)
 * which signs in the seeded `admin@dev.local` user and redirects to /inbox.
 * Subsequent goto() calls share the storage state with that page.
 */
export const test = base.extend<{ authed: Page }>({
  authed: async ({ page }, use) => {
    await page.goto("/api/dev/sign-in")
    await page.waitForURL((url) => !url.pathname.startsWith("/api/dev/"), {
      timeout: 10_000,
    })
    await use(page)
  },
})

export { expect } from "@playwright/test"
