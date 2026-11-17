import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
});

test('country selection resets public information and scopes crisis and country administration forms', async ({
  page,
}) => {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const partnerId = '12345678-1234-1234-1234-123456789abc';
  const organisations: { id: string; name: string; enabled: boolean; primaryCrises: []; verification?: { verificationState: string } }[] =
    [{ id: partnerId, name: 'Response organisation', enabled: false, primaryCrises: [] }];
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
    else if (path === '/countries/NP/services' && route.request().method() === 'PUT') {
      const { languages, requiredAlertLanguages, contacts } = route.request().postDataJSON();
      Object.assign(countries.find(country => country.code === 'NP')!, {
        languages, requiredAlertLanguages, emergencyContactsJson: JSON.stringify(contacts),
      });
      return route.fulfill({ status: 204 });
    }
    else if (path === '/public/lookups') data = { crises: [], organisations };
    else if (path === '/admin/organisations') {
      if (route.request().method() === 'POST') {
        const partner = { id: 'new', name: route.request().postDataJSON().name, enabled: true, primaryCrises: [] as [] };
        organisations.push(partner);
        data = partner;
      } else data = organisations.filter(o => o.enabled);
    } else if (path === `/admin/organisations/${partnerId}/countries/NP`) {
      organisations[0].enabled = true;
      organisations[0].verification = { verificationState: 'Verified' };
    }
    else if (path === '/admin/audit' || path === '/admin/deliveries')
      data = { items: [], total: 0, pageNumber: 1, pageSize: 10 };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
  await page.goto('/contact');
  await expect(page.getByRole('link', { name: 'Call 119', exact: true })).toHaveAttribute('href', 'tel:119');
  await page.getByLabel('Country', { exact: true }).selectOption('NP');
  await expect(page.getByRole('link', { name: 'Call 100', exact: true })).toHaveAttribute('href', 'tel:100');
  await expect(page.getByRole('link', { name: 'Call 119', exact: true })).toHaveCount(0);
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
  const existing = page.getByRole('button', { name: /Response organisation.*Verified/ });
  await expect(existing).toHaveCount(0);
  await page.getByRole('button', { name: 'Add organisation' }).click();
  await page.getByLabel('Organisation setup').selectOption('existing');
  await page.getByLabel('Organisation ID', { exact: true }).fill(partnerId);
  await page.getByRole('button', { name: 'Enable in Nepal', exact: true }).click();
  await expect(existing.getByText('Verified', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Assign staff' }).click();
  await expect(page.getByLabel('Organisation', { exact: true })).toHaveValue(partnerId);
  await page.goBack();
  await page.getByRole('button', { name: 'Add organisation' }).click();
  await page.getByLabel('Organisation name', { exact: true }).fill('Nepal Relief Network');
  await page.getByRole('button', { name: 'Create organisation' }).click();
  await expect(page.getByRole('button', { name: /Nepal Relief Network.*Pending verification/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Assign staff' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review verification' }).click();
  await expect(page.getByRole('heading', { name: 'Verification in Nepal' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify partner' })).toBeDisabled();
  await expect.poll(() => writes.find((w) => w.path === '/admin/organisations')?.body.countryCode).toBe('NP');
  await page.getByRole('link', { name: 'Country settings' }).click();
  await expect(page.getByRole('checkbox', { name: 'Make English available' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Require Hindi for alerts' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Make Hindi available' }).check();
  await page.getByRole('checkbox', { name: 'Require Hindi for alerts' }).check();
  await page.getByRole('checkbox', { name: 'Make Hindi available' }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Require Hindi for alerts' })).not.toBeChecked();
  await expect(page.getByRole('group', { name: 'New contact' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add contact' }).click();
  const contact = page.getByRole('group', { name: 'New contact' });
  await contact.getByLabel('Service name').fill('Example response desk');
  await contact.getByLabel('Telephone').fill('1234');
  await contact.getByLabel('Official source').fill('https://example.test/contact');
  await page.getByRole('button', { name: 'Save and publish' }).click();
  await expect.poll(() => writes.some((w) => w.path === '/countries/NP/services')).toBe(true);
  expect(writes.find((w) => w.path === '/countries/NP/services')?.body).toMatchObject({
    languages: 'en,ne', requiredAlertLanguages: 'en',
    contacts: expect.arrayContaining([{ label: 'Example response desk', number: '1234', sourceUrl: 'https://example.test/contact' }]),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Public services settings for Nepal are live.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Approvals', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/contact');
  await expect(page.getByRole('link', { name: 'Call 1234', exact: true })).toHaveAttribute('href', 'tel:1234');
  await page.getByLabel('Country', { exact: true }).selectOption('IN');
  await page.goto('/contact');
  await expect(page.getByRole('link', { name: 'Call 112', exact: true })).toHaveAttribute('href', 'tel:112');
  await expect(page.getByRole('link', { name: 'Call 100', exact: true })).toHaveCount(0);
});

for (const role of ['Administrator', 'CountryAdministrator']) {
  test(`${role} can navigate the admin sidebar and keep the correct item selected`, async ({ page }) => {
    const globalAdmin = role === 'Administrator';
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      const responses: Record<string, unknown> = {
        '/auth/refresh': {
          accessToken: 'test',
          user: {
            id: 'admin',
            name: 'Test Administrator',
            email: 'admin@example.test',
            language: 'en',
            roles: [role],
            memberships: [{ role, countryCode: 'LK', organisationId: 'admin-org' }],
          },
        },
        '/public/lookups': { crises: [], organisations: [] },
        '/admin/reports': { generatedAt: '2026-11-15T14:01:08Z', countries: [], stock: [] },
        '/logistics': { countries: [{ code: 'LK', name: 'Sri Lanka' }], depots: [], inventory: [],
          crises: [], areas: [], partners: [], orders: [], actors: {} },
        '/admin/audit': { items: [], total: 0 },
        '/admin/approvals': { items: [], activeGlobalAdministrators: 2 },
        '/admin/deliveries': { items: [], total: 0 },
        '/admin/system': { checkedAt: '2026-11-12T00:00:00Z', integrations: [], notificationQueue: [] },
        '/notifications/unread-count': { count: 0 },
        '/staff/shelters': [{
          id: 'shelter',
          organisationId: 'shelter-org',
          name: 'Community shelter',
          address: 'Gampaha',
          available: 40,
          reserved: 0,
          occupancy: 0,
          open: true,
        }],
      };
      await route.fulfill({ json: responses[path] ?? [] });
    });

    const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
    const selected = nav.locator('[aria-current="page"]');
    const mainHeading = page.getByRole('heading', { level: 1 });
    const overviewTitle = globalAdmin ? 'System administration' : 'Country administration';
    const destinations = [
      ['Unassigned cases', '/admin?section=cases', 'Unassigned cases'],
      ['Users & access', '/admin?section=users', 'Users & access'],
      ['Organisations', '/admin?section=organisations', 'Organisations'],
      ...(globalAdmin ? [
        ['Integrations', '/admin?section=integrations', 'Integrations'],
        ['Activity', '/admin?section=activity', 'Activity'],
      ] : []),
      ['Crisis operations', '/admin/crises', 'Crises & public information'],
      ['Resources', '/admin/resources', 'Resources & Logistics'],
      ['Shelters', '/admin/shelters', 'Shelter management'],
      ['Overview', '/admin', overviewTitle],
    ];

    await page.goto('/admin');
    await expect(selected).toHaveText('Overview');
    await expect(nav.getByRole('link', { name: 'Approvals', exact: true })).toHaveCount(0);
    const overviewCardTops = await page.locator('.admin-overview-card').evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().top),
    );
    expect(new Set(overviewCardTops).size).toBe(1);
    for (const [label, path, heading] of destinations) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new URL(path, page.url()).href);
      await expect(mainHeading).toHaveText(heading);
      await expect(selected).toHaveText(label);
      await expect(nav.locator('a.active')).toHaveCount(1);
      if (label === 'Users & access')
        await expect(page.getByRole('heading', { name: 'System Administrator access requests' })).toHaveCount(globalAdmin ? 1 : 0);
      if (label === 'Shelters') await expect(page.getByRole('heading', { name: 'Community shelter' })).toBeVisible();
    }

    await page.goBack();
    await expect(selected).toHaveText('Shelters');
    await page.reload();
    await expect(mainHeading).toHaveText('Shelter management');
    await expect(selected).toHaveText('Shelters');

    if (globalAdmin) {
      await page.goto('/admin?section=activity');
      const audit = page.getByRole('heading', { name: 'Recent Audit History' });
      const delivery = page.getByRole('heading', { name: 'Notification delivery' });
      await expect(audit).toBeVisible();
      await expect(delivery).toBeVisible();
      expect((await delivery.boundingBox())!.y).toBeCloseTo((await audit.boundingBox())!.y);

      await page.setViewportSize({ width: 390, height: 844 });
      const mobileAudit = (await audit.boundingBox())!;
      const mobileDelivery = (await delivery.boundingBox())!;
      expect(mobileDelivery.x).toBeCloseTo(mobileAudit.x);
      expect(mobileDelivery.y).toBeGreaterThan(mobileAudit.y + mobileAudit.height);
    }

    if (!globalAdmin) {
      for (const section of ['integrations', 'activity']) {
        await page.goto(`/admin?section=${section}`);
        await expect(mainHeading).toHaveText(overviewTitle);
        await expect(selected).toHaveText('Overview');
        await expect(page.getByRole('link', { name: /Integrations|Activity/ })).toHaveCount(0);
      }
    }
  });
}
