import { fulfillStock } from './fulfill-stock';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const seedPassword = process.env.SURAKUMA_ACCEPTANCE_PASSWORD ?? (JSON.parse(
  readFileSync(new URL('../../backend/data/development-settings.json', import.meta.url), 'utf8'),
) as { Seed: { Password: string } }).Seed.Password;
test('public homepage and Sinhala mobile navigation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A little help today. A safer tomorrow.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Request help', exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel('Language', { exact: true }).selectOption('si');
  await expect(
    page.getByRole('heading', { name: 'අද පුංචි උපකාරයක්. හෙට සුරක්ෂිත හෙටක්.' }),
  ).toBeVisible();
});
test('citizen submits, staff review AI, logistics deliver partial aid and close the case', async ({
  page,
}, run) => {
  test.setTimeout(120000);
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('citizen@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(seedPassword);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Amara' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hello, Amara' })).toBeVisible();
  await page.getByRole('link', { name: 'Request assistance', exact: true }).click();
  await page.getByRole('radio', { name: /^Food & water/ }).press('Space');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page
    .getByLabel('Crisis event', { exact: true })
    .selectOption({ label: 'Kelani River flood response' });
  await expect(page.getByText(/Your request will be sent to the response centre/)).toBeVisible();
  await page.getByLabel('Which item do you need?').selectOption('DryRations');
  await page.getByLabel('When will it run out?').selectOption('WithinSixHours');
  await page
    .getByLabel('Describe what you need', { exact: true })
    .fill(
      'Synthetic end-to-end scenario: our household needs ten food packs.',
    );
  await page.getByLabel('Measurement unit', { exact: true }).selectOption('packs');
  await page.getByLabel('Quantity needed', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Location', { exact: true }).fill('Demo collection point in Kelaniya');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Your request has been received' }),
  ).toBeVisible();
  const id = page.url().split('/').pop()!;
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.waitForURL('/');
  await page.getByRole('link', { name: 'Log in', exact: true }).first().click();
  await page.getByLabel('Email address', { exact: true }).fill('case@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(seedPassword);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('/staff');
  await page.goto(`/staff/cases/${id}`);
  await page.getByRole('button', { name: 'Begin review', exact: true }).click();
  const items = page.getByRole('dialog', { name: 'Review requested items' });
  await items.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Verify request', exact: true }).click();
  await expect(page.locator('.cm-page-header').getByText('Verified', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Triage recommendation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Citizen’s description' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate recommendation', exact: true })).toHaveCount(0);
  await expect(page.locator('.cm-page-header').getByText('Verified', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve case', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve case', exact: true })).toHaveCount(0);
  await page.screenshot({ path: run.outputPath('case-review.png'), fullPage: true });

  async function switchAccount(account: string, destination: string) {
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await page.waitForURL('/');
    await page.getByRole('link', { name: 'Log in', exact: true }).first().click();
    await page.getByLabel('Email address', { exact: true }).fill(`${account}@surakuma.test`);
    await page.getByLabel('Password', { exact: true }).fill(seedPassword);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname === destination || url.pathname.startsWith(destination + '/'),
    );
  }
  await switchAccount('coordinator', '/staff');
  await page.goto(`/staff/cases/${id}`);
  await page.getByLabel('Coordinator handoff reason').fill('Verified the household need and delivery plan.');
  await page.getByRole('button', { name: 'Authorize fulfillment' }).click();
  await expect(page.getByRole('button', { name: 'Authorize fulfillment' })).toHaveCount(0);
  await switchAccount('logistics', '/staff');
  await page.getByRole('navigation', { name: 'Workspace navigation' }).locator('a[href^="/staff/resources"]').click();
  await page.getByRole('button', { name: 'Add resource', exact: true }).click();
  const resourceName = `Browser demo packs ${Date.now()}`;
  const depotName = `Acceptance depot ${Date.now()}`;
  await page.getByRole('button', { name: 'Register a depot', exact: true }).click();
  await page.getByLabel('Organisation', { exact: true }).selectOption({ label: 'Surakuma Community Response (demo)' });
  await page.getByLabel('Depot name', { exact: true }).fill(depotName);
  await page.getByLabel('Depot location', { exact: true }).fill('Synthetic Colombo depot');
  await page.getByRole('button', { name: 'Save depot', exact: true }).click();
  await page.getByRole('button', { name: 'Add resource', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add resource' }).getByLabel('Depot', { exact: true }).selectOption({ label: depotName });
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Longitude', { exact: true })).toHaveValue('');
  await page.getByLabel('Latitude', { exact: true }).fill('6.92');
  await page.getByLabel('Longitude', { exact: true }).fill('79.9');
  await page.getByLabel('Resource name', { exact: true }).selectOption('custom');
  await page.getByLabel('Custom resource name', { exact: true }).fill(resourceName);
  await page.getByLabel('Category', { exact: true }).selectOption('FoodWater');
  await page.getByRole('dialog', { name: 'Add resource' }).getByLabel('Unit', { exact: true }).selectOption('packs');
  await page.getByLabel('Opening stock', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Save resource', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: new RegExp(resourceName) })).toBeVisible();
  await page.goto(`/staff/cases/${id}`);
  await fulfillStock(page, resourceName, 'packs', 6, 'ACCEPTANCE-PARTIAL');
  await expect(page.getByText('Awaiting allocation · 4 packs')).toBeVisible();
  await expect(page.getByText(/6 packs delivered/)).toBeVisible();
  await page.screenshot({ path: run.outputPath('partial-delivery.png'), fullPage: true });

  await page.getByRole('navigation', { name: 'Workspace navigation' }).locator('a[href^="/staff/resources"]').click();
  await page.getByRole('button', { name: 'Record stock', exact: true }).click();
  await page.getByLabel('Resource', { exact: true }).selectOption({ label: `${resourceName} · ${depotName} (LK)` });
  await page.getByLabel('Quantity (packs)', { exact: true }).fill('4');
  await page.getByLabel('Reason', { exact: true }).fill('Synthetic shortage resolved');
  await page.getByRole('button', { name: 'Save stock movement', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Stock movement recorded.' })).toBeVisible();
  await page.goto(`/staff/cases/${id}`);
  await fulfillStock(page, resourceName, 'packs', 4, 'ACCEPTANCE-REMAINDER');
  await expect(page.getByText(/10 packs delivered/)).toBeVisible();
  await switchAccount('case', '/staff');
  await page.goto(`/staff/cases/${id}`);
  await page.getByRole('button', { name: 'Close completed case', exact: true }).click();
  await expect(page.locator('.cm-page-header').getByText('Completed', { exact: true })).toBeVisible();
  await switchAccount('citizen', '/app');
  await page.goto(`/app/requests/${id}`);
  await expect(page.getByText('10 / 10 packs', { exact: true })).toBeVisible();
});
