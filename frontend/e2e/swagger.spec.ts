import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('Swagger executes the public shelter endpoint and returns HTTP 200', async ({ page }) => {
  await page.goto('https://localhost:7043/swagger/index.html');
  const operation = page
    .locator('.opblock-get')
    .filter({
      has: page.locator('.opblock-summary-path').filter({ hasText: /^\/api\/v1\/shelters$/ }),
    });
  await operation.locator('.opblock-summary-control').click();
  await operation.getByRole('button', { name: 'Try it out', exact: true }).click();
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(
    operation.locator('.live-responses-table .response-col_status:not(.col_header)'),
  ).toContainText('200');
  await operation.locator('.responses-wrapper').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '../docs/screenshots/swagger-public-shelters.png' });
  const response = await page.request.get('https://localhost:7043/api/v1/shelters');
  expect(response.status()).toBe(200);
  const shelters = await response.json();
  const folder = resolve(import.meta.dirname, '../../docs/testing');
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    resolve(folder, 'swagger-evidence.json'),
    JSON.stringify(
      {
        runtimeTimestamp: new Date().toISOString(),
        method: 'GET',
        path: '/api/v1/shelters',
        swaggerExecutionStatus: 200,
        directApiStatus: response.status(),
        returnedFacilities: shelters.length,
        screenshot: 'docs/screenshots/swagger-public-shelters.png',
        note: 'Public synthetic facility response. No login body, token, API key or private request data was recorded.',
      },
      null,
      2,
    ),
  );
});
