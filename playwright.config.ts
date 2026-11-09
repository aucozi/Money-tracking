import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * End-to-end tests drive the exported web build at an iPhone viewport.
 * Build first with `npm run build:web`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    // iPhone-sized viewport and touch, on Chromium so one browser install covers CI and local runs.
    ...devices['iPhone 15'],
    defaultBrowserType: 'chromium',
    browserName: 'chromium',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  webServer: {
    command: `npx serve -s dist -l ${PORT} --no-clipboard`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
