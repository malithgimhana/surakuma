import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
});

const emptyCrisisAlerts = { items: [], total: 0, publishedCount: 0 };

test('country selection resets public information and scopes crisis and country administration forms', async ({
  page,
}) => {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const partnerId = '12345678-1234-1234-1234-123456789abc';
  const organisations: { id: string; countryCode: string; name: string; enabled: boolean; primaryCrises: []; verification?: { verificationState: string } }[] =
    [{ id: partnerId, countryCode: 'NP', name: 'Response organisation', enabled: true, primaryCrises: [], verification: { verificationState: 'Verified' } }];
  const crises: { id: string; countryCode: string; name: string; active: boolean }[] = [];
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
    else if (path === '/crises') {
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON();
        const created = { id: 'np-response', ...input, active: true };
        crises.push(created);
        data = created;
      } else data = crises.filter(crisis => crisis.countryCode === url.searchParams.get('countryCode'));
    } else if (path === '/admin/crisis-operations/alerts') data = emptyCrisisAlerts;
    else if (path === '/countries/NP/services' && route.request().method() === 'PUT') {
      const { languages, requiredAlertLanguages, contacts } = route.request().postDataJSON();
      Object.assign(countries.find(country => country.code === 'NP')!, {
        languages, requiredAlertLanguages, emergencyContactsJson: JSON.stringify(contacts),
      });
      return route.fulfill({ status: 204 });
    }
    else if (path === '/public/lookups')
      data = { crises: [], organisations: organisations.filter(o => o.countryCode === url.searchParams.get('countryCode') && o.verification?.verificationState === 'Verified') };
    else if (path === '/admin/organisations') {
      if (route.request().method() === 'POST') {
        const { name, countryCode } = route.request().postDataJSON();
        const partner = { id: 'new', name, countryCode, enabled: true, primaryCrises: [] as [] };
        organisations.push(partner);
        data = partner;
      } else data = organisations.filter(o => o.enabled && o.countryCode === url.searchParams.get('countryCode'));
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
  await expect(page.locator('input[lang=si]')).toHaveCount(0);
  await page.getByText('Optional translations (Nepali)', { exact: true }).click();
  await expect(page.getByLabel('Nepali title', { exact: true })).toBeEnabled();
  await page.goto('/admin?section=organisations');
  const existing = page.getByRole('button', { name: /Response organisation.*Verified/ });
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
        '/countries': [{ code: 'LK', name: 'Sri Lanka', languages: 'en,si,ta', requiredAlertLanguages: 'en,si,ta' }],
        '/admin/crisis-operations/alerts': emptyCrisisAlerts,
        '/admin/reports': { generatedAt: '2026-11-15T14:01:08Z', countries: [], stock: [] },
        '/admin/overview': { stock: { belowThreshold: 0, outOfStock: 0 },
          shelters: { openShelters: 0, capacity: 0, occupancy: 0, reserved: 0, available: 0 },
          partnerVerification: { count: 0 } },
        '/logistics': { countries: [{ code: 'LK', name: 'Sri Lanka' }], depots: [], inventory: [],
          crises: [], areas: [], partners: [], orders: [], actors: {} },
        '/admin/audit': { items: [], total: 0 },
        '/admin/deliveries': { items: [], total: 0 },
        '/admin/system': { checkedAt: '2026-11-12T00:00:00Z', integrations: [], notificationQueue: [] },
        '/notifications/unread-count': { count: 0 },
        '/staff/shelters': { entries: [{ shelter: {
          id: 'shelter',
          organisationId: 'shelter-org',
          name: 'Community shelter',
          address: 'Gampaha',
          available: 40,
          capacity: 40,
          reserved: 0,
          occupancy: 0,
          open: true,
          facilities: 'Water',
          updatedAt: '2026-11-12T00:00:00Z',
        }, eligible: true, crises: [], warnings: [] }],
        statistics: { total: 1, available: 40, occupied: 0, households: 0, attention: 0 } },
      };
      await route.fulfill({ json: responses[path] ?? [] });
    });

    const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
    const selected = nav.locator('[aria-current="page"]');
    const mainHeading = page.getByRole('heading', { level: 1 });
    const overviewTitle = globalAdmin ? 'System Administration' : 'Country administration';
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

    await page.setViewportSize({ width: 1440, height: 875 });
    await page.goto('/admin');
    await expect(selected).toHaveText('Overview');
    await expect(nav.getByRole('link', { name: 'Approvals', exact: true })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Response figures' }).getByRole('listitem')).toHaveCount(5);
    const overviewCardTops = await page.getByRole('list', { name: 'Response figures' }).getByRole('listitem').evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().top),
    );
    expect(new Set(overviewCardTops).size).toBe(1);
    const sidebar = page.locator('.sidebar');
    const logout = sidebar.getByRole('button', { name: 'Log out' });
    const sidebarLayout = () => sidebar.evaluate((el) => ({
      width: el.clientWidth,
      background: getComputedStyle(el).backgroundColor,
      rows: Array.from(el.querySelectorAll('nav a'), (link) => {
        const { y, height } = link.getBoundingClientRect();
        return [y, height];
      }),
    }));
    const overviewSidebar = await sidebarLayout();
    await expect(logout).toBeInViewport();
    for (const [label, path, heading] of destinations) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new URL(path, page.url()).href);
      await expect(mainHeading).toHaveText(heading);
      await expect(selected).toHaveText(label);
      await expect(nav.locator('a.active')).toHaveCount(1);
      if (label === 'Crisis operations') {
        expect(await sidebarLayout()).toEqual(overviewSidebar);
        await expect(logout).toBeInViewport();
      }
      if (label === 'Users & access')
        await expect(page.getByRole('heading', { name: 'System Administrator access requests' })).toHaveCount(0);
      if (label === 'Shelters') await expect(page.getByRole('heading', { name: 'Community shelter' })).toBeVisible();
    }

    await page.goBack();
    await expect(selected).toHaveText('Shelters');
    await page.reload();
    await expect(mainHeading).toHaveText('Shelter management');
    await expect(selected).toHaveText('Shelters');

    if (globalAdmin) {
      await page.goto('/admin?section=activity');
      const audit = page.getByRole('heading', { name: 'Audit history' });
      const delivery = page.getByRole('heading', { name: 'Notification delivery' });
      await expect(audit).toBeVisible();
      await expect(delivery).toBeVisible();
      const auditCard = page.locator('.admin-tab-activity-grid .card').filter({ has: audit });
      const deliveryCard = page.locator('.admin-tab-activity-grid .card').filter({ has: delivery });
      expect((await deliveryCard.boundingBox())!.y).toBeCloseTo((await auditCard.boundingBox())!.y);

      await page.setViewportSize({ width: 390, height: 844 });
      const mobileAudit = (await audit.boundingBox())!;
      const mobileDelivery = (await delivery.boundingBox())!;
      expect(mobileDelivery.x).toBeCloseTo(mobileAudit.x);
      expect(mobileDelivery.y).toBeGreaterThan(mobileAudit.y + mobileAudit.height);
      const menu = page.locator('.workspace-top .mobile-menu');
      await menu.click();
      const dismiss = page.getByRole('button', { name: 'Close navigation', exact: true });
      await expect(dismiss).toBeFocused();
      await dismiss.click();
      await expect(menu).toBeFocused();
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

test('Overview switches countries and refreshes its authorized dashboard data', async ({ page }) => {
  const countries = [
    { code: 'LK', name: 'Sri Lanka', crisis: 'Kelani flood', district: 'Colombo', latitude: 6.93, longitude: 79.89, open: 12 },
    { code: 'IN', name: 'India', crisis: 'Assam flood', district: 'Guwahati', latitude: 26.14, longitude: 91.73, open: 8 },
    { code: 'NP', name: 'Nepal', crisis: 'Kathmandu response', district: 'Kathmandu', latitude: 27.71, longitude: 85.32, open: 4 },
  ];
  let reads = 0;
  const writes: string[] = [];
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (request.method() !== 'GET' && path !== '/auth/refresh') writes.push(path);
    const selected = countries.find(country => country.code === url.searchParams.get('countryCode')) ?? countries[0];
    const filtered = url.searchParams.has('crisisId');
    if (path === '/admin/overview') reads++;
    const responses: Record<string, unknown> = {
      '/auth/refresh': { accessToken: 'test', user: { id: 'admin', name: 'System Administrator', language: 'en', roles: ['Administrator'], memberships: [] } },
      '/countries': countries.map(country => ({ ...country, languages: 'en', requiredAlertLanguages: 'en' })),
      '/ready': { status: 'ready' },
      '/public/lookups': { crises: [], organisations: [] },
      '/crises': [{ id: selected.code.toLowerCase(), name: selected.crisis, district: selected.district,
        latitude: selected.latitude, longitude: selected.longitude, active: true }],
      '/admin/crisis-operations/alerts': emptyCrisisAlerts,
      [`/admin/crisis-operations/crises/${selected.code.toLowerCase()}/snapshot`]: {
        activeShelters: 1, shelteredPeople: selected.open, lastUpdated: '2026-11-17T07:00:00Z',
      },
      '/admin/reports': { countries: (url.searchParams.get('scope') === 'all' ? countries : [selected]).map(country => ({
        countryCode: country.code, country: country.name, activeCrises: 1, open: filtered ? 1 : country.open,
        overdue: 1, unassigned: 2, resolved: 3,
      })) },
      '/admin/overview': {
        stock: { belowThreshold: selected.open / 4, outOfStock: 1 },
        shelters: { openShelters: 1, capacity: 100, reserved: 10, occupancy: selected.open, available: 90 - selected.open },
        partnerVerification: { count: 1, oldestAt: '2026-11-17T07:20:00Z' },
      },
      '/admin/alerts': [
        { id: 'case', conditionKey: 'unassigned:case', countryCode: selected.code, message: `${selected.code} case is awaiting assignment.`,
          createdAt: '2026-11-17T07:10:00Z', link: '/admin?section=cases' },
        { id: 'delivery', conditionKey: 'delivery:test', countryCode: selected.code, message: 'Delivery outcome needs investigation.',
          createdAt: '2026-11-17T07:00:00Z', link: '/admin?section=activity' },
      ],
      '/admin/system': { integrations: [
        { id: 'email', mode: 'Brevo', state: 'Configured' },
        { id: 'ai', mode: 'Deterministic fallback', state: 'Fallback' },
        { id: 'mapping', mode: 'OpenStreetMap', state: 'Unavailable' },
      ], notificationQueue: [{ state: 'Review', count: selected.open }] },
      '/admin/audit': [{ id: 'audit', action: 'CrisisCreated', createdAt: '2026-11-17T07:20:00Z' }],
      '/notifications/unread-count': { count: 0 },
      '/requests': { items: [], total: 0 },
    };
    await route.fulfill({ json: responses[path] ?? [] });
  });

  await page.setViewportSize({ width: 1440, height: 875 });
  await page.addInitScript(() => localStorage.setItem('surakuma.theme', 'dark'));
  await page.goto('/admin');
  const comparison = page.getByRole('table', { name: 'Country operations overview' });
  const metrics = page.getByRole('list', { name: 'Response figures' });
  const openCount = metrics.getByRole('link', { name: /^Open cases/ }).locator('strong');
  const crisis = page.getByRole('combobox', { name: 'Crisis' });
  await expect(page.getByRole('heading', { name: 'System Administration' })).toBeVisible();
  await expect(openCount).toHaveText('12');
  await expect(page.getByText('Data connection verified')).toBeVisible();
  await expect(page.getByText('Configured', { exact: true })).toBeVisible();
  await expect(page.getByText('Needs review', { exact: true })).toBeVisible();
  await expect(comparison.getByRole('row')).toHaveCount(4);
  const fits = () => page.getByRole('region', { name: 'Country operations table' })
    .evaluate(region => region.scrollWidth <= region.clientWidth);
  await expect.poll(fits).toBe(true);
  await expect(page.getByRole('link', { name: /78 \/ 100/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /pending System Administrator access requests/i })).toHaveCount(0);
  const marker = page.locator('.overview-crisis-map path.leaflet-interactive');
  await expect(marker).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('overview-lk-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 820 });
  await expect.poll(fits).toBe(true);
  await marker.click();
  await expect(page).toHaveURL(/\/admin\/crises\?crisisId=lk/);
  await expect(page.getByRole('heading', { name: 'Kelani flood', exact: true })).toBeFocused();
  await page.goBack();
  await crisis.selectOption('lk');
  await expect(openCount).toHaveText('1');
  await expect(comparison.getByRole('row', { name: /Sri Lanka/ }).getByRole('cell', { name: '12' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Country', exact: true }).selectOption('NP');
  await expect(crisis).toHaveValue('');
  await expect(openCount).toHaveText('4');
  await expect(page.getByRole('heading', { name: 'Crisis distribution · Nepal' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Kathmandu response/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Kelani flood/ })).toHaveCount(0);
  await expect(page.getByText('NP case is awaiting assignment.')).toBeVisible();
  await comparison.getByRole('button', { name: /India/ }).click();
  await expect(page.getByRole('combobox', { name: 'Country', exact: true })).toHaveValue('IN');
  await expect(openCount).toHaveText('8');
  await expect(page.getByRole('heading', { name: 'Crisis distribution · India' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Assam flood/ })).toBeVisible();
  await expect(comparison.getByRole('row')).toHaveCount(4);
  const previousReads = reads;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  expect(writes).toEqual([]);
  await page.getByRole('region', { name: 'Priority action queue' }).getByRole('link', { name: 'View all' }).click();
  await expect(page.getByRole('link', { name: /Inventory needs review/ })).toHaveAttribute('href', '/admin/resources');

  await page.setViewportSize({ width: 900, height: 950 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
  await expect.poll(fits).toBe(true);
  await page.screenshot({ path: test.info().outputPath('overview-in-tablet.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Country', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: test.info().outputPath('overview-in-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  await page.locator('.sidebar-scrim').click({ position: { x: 350, y: 200 } });
  const accessibility = await new AxeBuilder({ page }).include('.admin-overview-shell')
    .withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
  await metrics.getByRole('link', { name: /^Overdue cases/ }).click();
  await expect(page.getByRole('heading', { name: 'Overdue cases' })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/cases\?view=overdue/);
  expect(browserErrors).toEqual([]);
});
