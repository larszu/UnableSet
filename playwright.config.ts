import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4499',
    viewport: { width: 1280, height: 800 },
    // In Umgebungen mit vorinstalliertem Chromium (PLAYWRIGHT_BROWSERS_PATH)
    // dessen Binary nutzen statt eines Neu-Downloads.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: 'node scripts/e2e-stack.mjs',
    url: 'http://127.0.0.1:4499/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
