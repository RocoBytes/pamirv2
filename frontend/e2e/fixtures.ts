import { test as base, expect } from '@playwright/test'
import { mockApiDefaults } from './helpers'

export { expect }

// Every spec imports `test` from here instead of '@playwright/test'. It makes
// the suite hermetic: the SPA talks to /api, which vite proxies to a real
// backend on localhost:3001 (and, through it, to Neon and the storage bucket).
// A request that no mock handles must never get there, so a catch-all route
// answers it with a 599 and the test fails when it ends, naming the request.
//
// Playwright runs the handlers of a page from the most recently registered to
// the oldest, so registering this one first makes it the LAST resort: every
// mock a spec (or helpers.ts) adds later takes precedence, as long as it hands
// unhandled requests on with route.fallback() and not route.continue(), which
// would skip this net and go straight to the network.
export const test = base.extend({
  page: async ({ page }, provide) => {
    const unmocked: string[] = []

    await page.route('**/api/**', (route) => {
      const request = route.request()
      unmocked.push(`${request.method()} ${new URL(request.url()).pathname}`)
      void route.fulfill({
        status: 599,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'e2e: request without a mock' }),
      })
    })

    // Baseline answers for the reads every screen makes. Registered after the net
    // and before the spec's own routes, so a spec's mock always wins.
    await mockApiDefaults(page)

    await provide(page)

    // A test often ends right after asserting a navigation (a login that lands on
    // /<slug>), while the page it landed on is still firing its first requests.
    // Let them settle so an unmocked one is caught every time, not only when the
    // timing happens to land it before the page closes.
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})

    if (unmocked.length > 0) {
      const counts = new Map<string, number>()
      for (const request of unmocked) counts.set(request, (counts.get(request) ?? 0) + 1)
      const list = [...counts].map(([request, n]) => `  ${request}${n > 1 ? ` (x${n})` : ''}`).join('\n')
      throw new Error(
        `The page made API requests that no mock handles:\n${list}\nAdd a mock for them in the spec or in e2e/helpers.ts.`,
      )
    }
  },
})
