import { defineConfig } from '@playwright/test';
export default defineConfig({
  outputDir: './test-results/international',
  testDir: './e2e',
  testMatch: 'international.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5190', channel: 'msedge', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 5190 --strictPort',
    url: 'http://127.0.0.1:5190',
    reuseExistingServer: false,
  },
});
