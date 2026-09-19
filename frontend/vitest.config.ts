import { defineConfig } from 'vitest/config'

// Unit tests live under src/**/*.test.ts; e2e/**/*.spec.ts belongs to Playwright
// and must stay out of vitest's default include glob.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
