import { defineConfig } from '@playwright/test';
import { join } from 'node:path';

const evidence = process.env.SURAKUMA_TEST_EVIDENCE;

export default defineConfig({
  outputDir: evidence ? join(evidence, 'Browser-Artifacts') : './test-results/live-international',
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 240000,
  use: {
    baseURL: 'http://127.0.0.1:5192',
    channel: 'msedge',
    ignoreHTTPSErrors: true,
    trace: evidence ? 'off' : 'retain-on-failure',
    video: !evidence && process.env.SURAKUMA_DEMO_VIDEO === '1' ? 'on' : 'off',
    actionTimeout: 15000,
  },
  reporter: evidence ? [
    ['list'],
    ['html', { outputFolder: join(evidence, 'Playwright-Report'), open: 'never' }],
    ['json', { outputFile: join(evidence, 'Playwright-Results.json') }],
  ] : 'list',
  webServer: {
    command: 'npm run dev -- --port 5192 --strictPort',
    url: 'http://127.0.0.1:5192',
    reuseExistingServer: false,
  },
});
