import { defineConfig, devices } from '@playwright/test';
const base = process.env.TEST_BASE ?? '/';
const port = Number(process.env.TEST_PORT ?? 4173);
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://127.0.0.1:${port}${base}`, channel: process.env.PW_CHANNEL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: `npm run preview -- --port ${port} --base ${base}`, url: `http://127.0.0.1:${port}${base}`, reuseExistingServer: !process.env.CI },
  projects: [ { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } } ],
});
