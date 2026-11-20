import { defineConfig, devices } from '@playwright/test'
import { E2E } from './e2e/ports.mjs'

/**
 * Browser end-to-end tests of the student's critical paths — see e2e/ and the
 * "End to end" section of TESTING.md.
 *
 * Starts its own API (in-memory, scripted tutor, temp uploads — e2e/serve-api.mjs)
 * and its own production build of the client (e2e/vite.config.mjs), on ports
 * that never clash with `npm run dev` / `npm run dev:api`. Never reuses a server
 * it did not start: a test that found one already listening could be writing
 * into somebody's development data.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { outputFolder: 'e2e/.report', open: 'never' }]],
  globalSetup: './e2e/global-setup.mjs',

  use: {
    baseURL: E2E.webOrigin,
    locale: 'en-US',
    // Wide enough that the tutor pane is docked beside the question (>= 1180px).
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } }],

  webServer: [
    {
      command: 'node e2e/serve-api.mjs',
      url: `${E2E.apiOrigin}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npx vite build --config e2e/vite.config.mjs --logLevel warn && npx vite preview --config e2e/vite.config.mjs',
      url: E2E.webOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
