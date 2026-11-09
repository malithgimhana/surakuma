import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const settings = JSON.parse(
  readFileSync(new URL('../../backend/data/development-settings.json', import.meta.url), 'utf8'),
) as { Seed: { Password: string } };
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
}) => {
  test.setTimeout(120000);
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('citizen@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(settings.Seed.Password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Amara' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hello, Amara' })).toBeVisible();
  await page.getByRole('link', { name: 'Request assistance', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page
    .getByLabel('Crisis event', { exact: true })
    .selectOption({ label: 'Kelani River flood response' });
  await expect(page.getByText(/Your request will be sent to the response centre/)).toBeVisible();
  await page
    .getByLabel('Describe what you need', { exact: true })
    .fill(
      'Synthetic end-to-end scenario: our household needs food packs and clean drinking water.',
    );
  await page.getByLabel('Quantity needed', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Location', { exact: true }).fill('Demo collection point in Kelaniya');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('This request contains fictional information only.').check();
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Your request has been received' }),
  ).toBeVisible();
  const id = page.url().split('/').pop()!;
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.waitForURL('/');
  await page.getByRole('link', { name: 'Log in', exact: true }).first().click();
  await page.getByLabel('Email address', { exact: true }).fill('case@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(settings.Seed.Password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('/staff');
  await page.goto(`/staff/cases/${id}`);
  await page.getByRole('button', { name: 'Begin review', exact: true }).click();
  await page.getByRole('button', { name: 'Verify request', exact: true }).click();
  await expect(page.locator('.page-header').getByText('Verified', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Generate recommendation', exact: true }).click();
  await expect(page.getByText('DEVELOPMENT RULES FALLBACK · not external AI')).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('button', { name: 'Approve case', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve case', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '../docs/screenshots/case-review.png', fullPage: true });

  async function switchAccount(account: string, destination: string) {
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await page.waitForURL('/');
    await page.getByRole('link', { name: 'Log in', exact: true }).first().click();
    await page.getByLabel('Email address', { exact: true }).fill(`${account}@surakuma.test`);
    await page.getByLabel('Password', { exact: true }).fill(settings.Seed.Password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname === destination || url.pathname.startsWith(destination + '/'),
    );
  }
  await switchAccount('logistics', '/staff');
  await page.getByRole('link', { name: 'Resources & logistics', exact: true }).click();
  await page.getByRole('button', { name: 'Add resource', exact: true }).click();
  const resourceName = `Browser demo packs ${Date.now()}`;
  await page.getByLabel('Resource name', { exact: true }).fill(resourceName);
  await page.getByLabel('Category', { exact: true }).selectOption('FoodWater');
  await page.getByLabel('Opening stock', { exact: true }).fill('6');
  await page.getByLabel('Location', { exact: true }).fill('Synthetic Colombo depot');
  await page.getByRole('button', { name: 'Save resource', exact: true }).click();
  await expect(page.getByRole('heading', { name: resourceName, exact: true })).toBeVisible();
  await page.goto(`/staff/cases/${id}`);
  const resource = page.getByLabel('Resource', { exact: true });
  await expect(resource.locator('option').filter({ hasText: resourceName })).toHaveCount(1);
  await resource.selectOption({
    label: `${resourceName} · 6 packs available · Synthetic Colombo depot`,
  });
  await page.getByLabel('Quantity', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Approve reservation' }).click();
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delivery', exact: true }).click();
  await expect(page.getByText('6 / 10', { exact: true })).toBeVisible();
  await expect(
    page.locator('.page-header').getByText('Partially delivered', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '../docs/screenshots/partial-delivery.png', fullPage: true });

  await page.getByRole('link', { name: 'Resources & logistics', exact: true }).click();
  const card = page
    .locator('.card')
    .filter({ has: page.getByRole('heading', { name: resourceName, exact: true }) });
  await card.getByLabel(`Replenish ${resourceName} quantity`, { exact: true }).fill('4');
  await card
    .getByLabel('Replenishment reason', { exact: true })
    .fill('Synthetic shortage resolved');
  await card.getByRole('button', { name: 'Add stock', exact: true }).click();
  await expect(card.locator('.stock-numbers').first()).toContainText('4');
  await page.goto(`/staff/cases/${id}`);
  await page
    .getByLabel('Resource', { exact: true })
    .selectOption({ label: `${resourceName} · 4 packs available · Synthetic Colombo depot` });
  await page.getByLabel('Quantity', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Approve reservation' }).click();
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delivery', exact: true }).click();
  await expect(page.getByText('10 / 10', { exact: true })).toBeVisible();
  await switchAccount('case', '/staff');
  await page.goto(`/staff/cases/${id}`);
  await page.getByRole('button', { name: 'Close completed case', exact: true }).click();
  await expect(page.locator('.page-header').getByText('Completed', { exact: true })).toBeVisible();
  await switchAccount('citizen', '/app');
  await page.goto(`/app/requests/${id}`);
  await expect(page.getByText('10 / 10', { exact: true })).toBeVisible();
});
