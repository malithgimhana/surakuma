import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

test('Swagger executes the public shelter endpoint and returns HTTP 200', async ({ page }, run) => {
  const api = process.env.SURAKUMA_API_PROXY ?? 'https://localhost:7043';
  await page.goto(api + '/swagger/index.html');
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
  const screenshot = 'swagger-public-shelters.png';
  await page.screenshot({ path: run.outputPath(screenshot) });
  const response = await page.request.get(api + '/api/v1/shelters');
  expect(response.status()).toBe(200);
  const shelters = await response.json();
  mkdirSync(run.outputDir, { recursive: true });
  writeFileSync(
    run.outputPath('swagger-evidence.json'),
    JSON.stringify(
      {
        runtimeTimestamp: new Date().toISOString(),
        method: 'GET',
        path: '/api/v1/shelters',
        swaggerExecutionStatus: 200,
        directApiStatus: response.status(),
        returnedFacilities: shelters.length,
        screenshot,
        responseBody: shelters,
        note: 'Public synthetic facility response. No login body, token, API key or private request data was recorded.',
      },
      null,
      2,
    ),
  );
});

test('Swagger readiness returns HTTP 200 for the isolated SQL database', async ({ page }, run) => {
  test.skip(!process.env.SURAKUMA_ACCEPTANCE_PASSWORD, 'Requires the isolated acceptance API.');
  const api = process.env.SURAKUMA_API_PROXY!;
  await page.goto(api + '/swagger/index.html');
  const operation = page.locator('.opblock-get').filter({
    has: page.locator('.opblock-summary-path').filter({ hasText: /^\/api\/v1\/ready$/ }),
  });
  await operation.locator('.opblock-summary-control').click();
  await operation.getByRole('button', { name: 'Try it out', exact: true }).click();
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/ready');
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  const ready = await response;
  expect(ready.status()).toBe(200);
  await expect(operation.locator('.live-responses-table .response-col_status:not(.col_header)')).toContainText('200');
  await operation.locator('.responses-wrapper').scrollIntoViewIfNeeded();
  await page.screenshot({ path: run.outputPath('swagger-database-readiness.png') });
  writeFileSync(run.outputPath('swagger-database-readiness.json'), JSON.stringify({
    runtimeTimestamp: new Date().toISOString(), method: 'GET', path: '/api/v1/ready',
    swaggerExecutionStatus: ready.status(), responseBody: await ready.json(),
  }, null, 2));
});
