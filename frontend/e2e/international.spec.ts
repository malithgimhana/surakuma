import { expect, test } from '@playwright/test';

test('country selection resets public information and scopes crisis and country administration forms', async ({
  page,
}) => {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const countries = [
    {
      code: 'LK',
      name: 'Sri Lanka',
      languages: 'en,si,ta',
      requiredAlertLanguages: 'en,si,ta',
      emergencyContactsJson: JSON.stringify([
        { label: 'Police emergency', number: '119', sourceUrl: 'https://www.police.lk/' },
      ]),
    },
    {
      code: 'NP',
      name: 'Nepal',
      languages: 'en,ne',
      requiredAlertLanguages: 'en',
      emergencyContactsJson: JSON.stringify([
        { label: 'Police emergency', number: '100', sourceUrl: 'https://www.nepalpolice.gov.np/' },
      ]),
    },
    {
      code: 'IN',
      name: 'India',
      languages: 'en,hi',
      requiredAlertLanguages: 'en',
      emergencyContactsJson: JSON.stringify([
        { label: 'Emergency response', number: '112', sourceUrl: 'https://www.mha.gov.in/' },
      ]),
    },
  ];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace('/api/v1', '');
    if (route.request().method() !== 'GET' && path !== '/auth/refresh')
      writes.push({ path, body: route.request().postDataJSON() || {} });
    let data: unknown = [];
    if (path === '/auth/refresh')
      data = {
        accessToken: 'test',
        user: {
          id: 'admin',
          name: 'Administrator',
          email: 'admin@example.test',
          language: 'en',
          roles: ['Administrator'],
          memberships: [],
        },
      };
    else if (path === '/countries') data = countries;
    else if (path === '/countries/NP/divisions')
      data = [{ id: 'province', name: 'Bagmati', levelName: 'Province', parentId: null }];
    else if (path === '/public/lookups')
      data = { crises: [], organisations: [{ id: 'org', name: 'Response organisation' }] };
    else if (path === '/admin/audit' || path === '/admin/deliveries')
      data = { items: [], total: 0, pageNumber: 1, pageSize: 10 };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
  await page.goto('/contact');
  await expect(page.getByRole('link', { name: '119', exact: true })).toBeVisible();
  await page.getByLabel('Country', { exact: true }).selectOption('NP');
  await expect(page.getByRole('link', { name: '100', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '119', exact: true })).toHaveCount(0);
  await page.goto('/staff/crises');
  await page.getByRole('button', { name: 'Create crisis', exact: true }).click();
  await page.getByLabel('Crisis name', { exact: true }).fill('Nepal response');
  await page.getByLabel('Administrative region', { exact: true }).selectOption('province');
  await page.getByLabel('Latitude', { exact: true }).fill('27.7');
  await page.getByLabel('Longitude', { exact: true }).fill('85.3');
  await page.getByRole('button', { name: 'Create response event' }).click();
  await expect.poll(() => writes.find((w) => w.path === '/crises')?.body.countryCode).toBe('NP');
  expect(writes.find((w) => w.path === '/crises')?.body.administrativeDivisionId).toBe('province');
  await expect(page.locator('[name=sinhalaTitle]')).toHaveCount(0);
  await expect(page.locator('[name=neTitle]')).toBeVisible();
  await page.goto('/admin?section=organisations');
  await page.getByRole('button', { name: 'Save public services' }).click();
  await expect.poll(() => writes.some((w) => w.path === '/countries/NP/services')).toBe(true);
  await page.getByLabel('Country', { exact: true }).selectOption('IN');
  await page.goto('/contact');
  await expect(page.getByRole('link', { name: '112', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '100', exact: true })).toHaveCount(0);
});
