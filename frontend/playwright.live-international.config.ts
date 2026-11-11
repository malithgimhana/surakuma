import { defineConfig } from '@playwright/test';
export default defineConfig({
  outputDir: './test-results/live-international',
  testDir: './e2e',
  testMatch: 'international-live.spec.ts',
  workers: 1,
  timeout: 240000,
  use: {
    baseURL: 'http://127.0.0.1:5192',
    channel: 'msedge',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    actionTimeout: 15000,
  },
  webServer: {
    command: 'npm run dev -- --port 5192 --strictPort',
    url: 'http://127.0.0.1:5192',
    reuseExistingServer: false,
  },
});
