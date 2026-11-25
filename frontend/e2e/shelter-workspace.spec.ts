import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({
  ...(process.env.SHELTER_QA_URL && { baseURL: process.env.SHELTER_QA_URL }),
  ...(process.env.SHELTER_QA_CHROME && { channel: 'chrome' }),
});

const staffRole = 'ShelterAdmin';
const organisationId = 'operator';
const country = 'LK';
const updated = '2026-11-20T04:00:00Z';
const shelter = {
  id: 'shelter-1',
  name: 'Central School Hall',
  address: 'Colombo district',
  countryCode: country,
  organisationId,
  administrativeDivisionId: 'colombo',
  latitude: 6.9271,
  longitude: 79.8612,
  capacity: 80,
  occupancy: 10,
  reserved: 4,
  available: 66,
  open: true,
  accessible: true,
  facilities: 'Water, toilets',
  updatedAt: updated,
  operationalUpdatedAt: updated,
};
const supply = {
  id: 'supply-1',
  reference: 'SUP-1001',
  category: 'FoodWater',
  unit: 'packs',
  quantity: 10,
  receivedQuantity: 4,
  reason: 'Food packs for the shelter store.',
  createdAt: updated,
  requestingOrganisationId: organisationId,
  targetOrganisationId: 'partner',
  cancelled: false,
};

async function mockShelterApi(page: Page) {
  const user = {
    id: 'staff',
    name: 'Malini De Silva',
    email: 'shelter@example.test',
    roles: [staffRole],
    language: 'en',
    memberships: [{ role: staffRole, organisationId, countryCode: country }],
  };
  const operator = { id: organisationId, name: 'Community Response' };
  const partner = { id: 'partner', name: 'Verified relief partner' };
  const rows = [
    {
      shelter: { ...shelter },
      eligible: false,
      reportedAvailable: 66,
      crises: [{ id: 'crisis', name: 'Flood response' }],
      warnings: [{ kind: 'stale', severity: 'warning' }],
    },
  ];
  const supplies = [supply];
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const requests: URL[] = [];
  let failOverview = false;
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    requests.push(url);
    const path = url.pathname.replace('/api/v1', '');
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === '/auth/refresh') return reply({ accessToken: 'test-token', user });
    if (path === '/countries') return reply([{ code: country, name: 'Sri Lanka' }]);
    if (path === '/countries/LK/divisions')
      return reply([{ id: 'colombo', name: 'Colombo', levelName: 'District', parentId: null }]);
    if (path === '/public/lookups') return reply({ organisations: [operator, partner] });
    if (path === '/maps/geocode') {
      const query = url.searchParams.get('query');
      if (query === 'Lookup unavailable') return reply({ title: 'Location search unavailable' }, 503);
      if (query === 'Reception Road') return reply({ features: [
        { geometry: { coordinates: [79.86, 6.92] }, properties: { label: '10 Reception Road' } },
        { geometry: { coordinates: [79.862, 6.922] }, properties: { label: '12 Reception Road' } },
      ] });
      return reply({ features: [] });
    }
    if (path === '/notifications/unread-count') return reply({ count: 2 });
    if (path === '/public/resource-units')
      return reply([{ code: 'packs', label: 'Packs', allowsFractions: false, stockCategories: ['FoodWater', 'Shelter'] }]);
    if (path === '/staff/shelters') {
      if (failOverview) return reply({ detail: 'Temporary API failure' }, 503);
      return reply({
        entries: rows,
        statistics: {
          total: rows.length,
          capacity: rows.reduce((sum, row) => sum + row.shelter.capacity, 0),
          reportedAvailable: rows.reduce((sum, row) => sum + row.reportedAvailable, 0),
          occupied: rows.length ? 10 : 0,
          available: rows[0]?.eligible ? rows[0].reportedAvailable : 0,
          reserved: rows.length ? 4 : 0,
          pendingArrivals: rows.length ? 1 : 0,
          households: rows.length ? 1 : 0,
          attention: rows.filter((row) => row.warnings.length).length,
        },
      });
    }
    if (path.startsWith('/staff/shelters/')) return reply({ households: [], activity: [] });
    if (req.method() === 'POST' || req.method() === 'PUT') {
      const body = req.postDataJSON();
      writes.push({ path, body });
      if (path === '/shelters') {
        const registered = {
          ...shelter,
          ...body,
          id: 'registered',
          pendingVerification: true,
          occupancy: 0,
          reserved: 0,
          available: body.capacity,
        };
        rows.push({
          shelter: registered,
          eligible: false,
          reportedAvailable: body.capacity,
          crises: [],
          warnings: [{ kind: 'pendingVerification', severity: 'warning' }],
        });
        return reply(registered);
      }
      if (path === '/shelters/' + shelter.id) {
        const updatedShelter = {
          ...shelter,
          ...body,
          available: body.capacity - shelter.occupancy - shelter.reserved,
        };
        rows[0] = {
          shelter: updatedShelter,
          eligible: true,
          reportedAvailable: updatedShelter.available,
          crises: rows[0].crises,
          warnings: [],
        };
        return reply(updatedShelter);
      }
      if (path === '/auth/profile') {
        user.name = body.name;
        return reply(user);
      }
      if (path === '/supply-support/LK') {
        const created = {
          ...supply,
          ...body,
          id: 'supply-2',
          reference: 'SUP-1002',
          receivedQuantity: 0,
        };
        supplies.push(created);
        return reply(created);
      }
    }
    if (path === '/auth/profile')
      return reply({
        assignments: [
          { id: 'assignment', role: staffRole, country: 'Sri Lanka', organisation: operator.name },
        ],
        workPhone: '+94 11 200 0000',
        volunteer: null,
      });
    if (path === '/supply-support/LK')
      return reply({
        requests: supplies,
        organisations: [operator, partner],
        requestingOrganisations: [operator],
        offeringOrganisations: [],
        receivableCommitments: [],
        commitments: [
          {
            id: 'offer',
            supportRequestId: supply.id,
            title: 'Food pack offer',
            status: 'InProgress',
            unit: 'packs',
          },
        ],
        receipts: [
          {
            id: 'receipt',
            contributionId: 'offer',
            quantity: 4,
            reference: 'DR-02',
            createdAt: updated,
            discrepancy: 'Six packs remain.',
          },
        ],
        statistics: {
          total: supplies.length,
          awaiting: supplies.length - 1,
          active: 1,
          delivered: 0,
        },
      });
    return reply([]);
  });
  return {
    requests,
    writes,
    clearShelters: () => rows.splice(0),
    failOverview: (value: boolean) => {
      failOverview = value;
    },
  };
}

test('Shelter Administrator views, reviews and registers shelters and tracks supplies in the assigned country', async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const { requests, writes } = await mockShelterApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('surakuma.country', 'NP'));
  await page.goto('/staff?role=ShelterAdmin');
  await expect(page.getByRole('heading', { name: 'Shelter Administrator Overview' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Country' })).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Assigned shelters' })).toBeVisible();
  const snapshot = page.getByRole('region', { name: 'Scrollable shelter snapshot' });
  expect(await snapshot.evaluate((element) => element.scrollWidth === element.clientWidth)).toBe(
    true,
  );
  await expect(
    page.getByRole('navigation', { name: 'Page navigation' }).getByRole('link', { name: 'Home' }),
  ).toHaveCSS('background-color', 'rgb(37, 59, 85)');
  await expect(
    page.getByRole('rowheader', { name: 'Central School Hall Colombo district' }),
  ).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(
    requests.some(
      (u) =>
        u.pathname.endsWith('/staff/shelters') &&
        u.searchParams.get('countryCode') === 'LK' &&
        u.searchParams.get('staffRole') === staffRole,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('overview.png'), fullPage: true });

  await page.getByRole('link', { name: 'Review Central School Hall' }).click();
  const details = page.getByRole('dialog', { name: shelter.name });
  await expect(details).toBeVisible();
  await expect(details.getByText('0 spaces confirmed for placement')).toBeVisible();
  await details.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Filter by district or region').selectOption('colombo');
  await page.getByLabel('Filter by crisis').selectOption('crisis');
  await page.getByLabel('Filter by operational status').selectOption('review');
  await page.getByLabel('Sort shelters').selectOption('capacity');
  await page.getByLabel('Search shelters').fill('missing');
  await expect(page.getByText('No matching shelters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('button', { name: 'Allocate household' })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('management.png'), fullPage: true });
  await page.getByRole('button', { name: 'Edit capacity' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel(/capacity/i).fill('100');
  await edit.getByRole('button', { name: 'Save operational update' }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Allocate household' })).toBeEnabled();
  expect(writes.find((write) => write.path === '/shelters/' + shelter.id)?.body.capacity).toBe(100);

  const workspaceNav = page.getByRole('navigation', { name: 'Workspace navigation' });
  await expect(workspaceNav.getByRole('link', { name: /add.*shelter/i })).toHaveCount(0);
  await page.getByRole('link', { name: 'Add shelter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Register a new shelter' })).toBeVisible();
  await expect(workspaceNav.getByRole('link', { name: 'Shelter management' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('button', { name: 'Continue to Location' })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('basics.png'), fullPage: true });
  await page.getByLabel('Shelter name').fill('New Reception Hall');
  await page.getByLabel('Operating organisation').selectOption(organisationId);
  await expect(page.getByLabel('Operating organisation').locator('option')).toHaveCount(2);
  await page.getByLabel('Maximum capacity').fill('50');
  await page.getByRole('button', { name: 'Continue to Location' }).click();
  await page.getByLabel('Administrative region').selectOption({ label: 'Colombo' });
  const address = page.getByLabel('Address', { exact: true });
  const searchLocation = page.getByRole('button', { name: 'Search location' });
  await expect(searchLocation).toBeDisabled();
  await address.fill('Lookup unavailable');
  await searchLocation.click();
  await expect(page.getByText('Location search is unavailable.', { exact: false })).toBeVisible();
  await page.getByLabel('Latitude').fill('91');
  await page.getByLabel('Longitude').fill('79.86');
  await expect(page.getByRole('button', { name: 'Continue to Facilities' })).toBeDisabled();
  await address.fill('Reception Road');
  await address.press('Enter');
  await expect(page.getByText('Choose a search result to place the pin.')).toBeVisible();
  expect(requests.some((url) => url.pathname.endsWith('/maps/geocode') &&
    url.searchParams.get('query') === 'Reception Road' && url.searchParams.get('countryCode') === country)).toBe(true);
  await page.getByRole('button', { name: '10 Reception Road' }).click();
  await expect(address).toHaveValue('10 Reception Road');
  await expect(page.getByLabel('Latitude')).toHaveValue('6.920000');
  await expect(page.getByLabel('Longitude')).toHaveValue('79.860000');
  const map = page.locator('.leaflet-container');
  const pin = map.locator('path.leaflet-interactive');
  await expect(pin).toBeVisible();
  const mapBounds = (await map.boundingBox())!;
  const pinBounds = (await pin.boundingBox())!;
  expect(Math.abs(pinBounds.x + pinBounds.width / 2 - mapBounds.x - mapBounds.width / 2)).toBeLessThan(2);
  expect(Math.abs(pinBounds.y + pinBounds.height / 2 - mapBounds.y - mapBounds.height / 2)).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath('location.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue to Facilities' }).click();
  await page.getByLabel('Accessible entrance').check();
  await page.getByLabel('Additional facilities').fill('Generator, Handwashing station');
  await page.getByRole('button', { name: 'Continue to Review' }).click();
  await expect(page.getByRole('heading', { name: 'Review & confirm' })).toBeVisible();
  await expect(page.getByText('New Reception Hall', { exact: true })).toBeVisible();
  await expect(page.getByText('Accessible entrance, Generator, Handwashing station')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register shelter' })).toBeDisabled();
  await page.getByLabel('I confirm that the shelter information is accurate.').check();
  await page.getByRole('button', { name: 'Edit Location', exact: true }).click();
  await expect(page.getByLabel('Address')).toHaveValue('10 Reception Road');
  await expect(page.getByLabel('Administrative region')).toHaveValue('colombo');
  await page.getByRole('button', { name: 'Continue to Facilities' }).click();
  await expect(page.getByLabel('Accessible entrance')).toBeChecked();
  await page.getByRole('button', { name: 'Continue to Review' }).click();
  await expect(page.getByRole('button', { name: 'Register shelter' })).toBeDisabled();
  await page.getByLabel('I confirm that the shelter information is accurate.').check();
  await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Register shelter' }).click();
  const registered = page.getByRole('dialog', { name: 'New Reception Hall' });
  await expect(registered.getByText(/Shelter registered/)).toBeVisible();
  expect(writes.filter((write) => write.path === '/shelters')).toHaveLength(1);
  expect(writes.find((write) => write.path === '/shelters')?.body).toMatchObject({
    countryCode: country,
    administrativeDivisionId: 'colombo',
    address: '10 Reception Road',
    latitude: 6.92,
    longitude: 79.86,
    name: 'New Reception Hall',
    capacity: 50,
    open: false,
    accessible: true,
    registrationId: expect.any(String),
  });
  await registered.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('link', { name: 'My profile' }).click();
  await expect(page.getByText('2 shelter records')).toBeVisible();
  await page.getByLabel('Full name').fill('Malini Silva');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Malini Silva' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('profile.png'), fullPage: true });

  await page.getByRole('link', { name: 'Supply support' }).click();
  await expect(page.getByRole('table', { name: 'Supply requests' })).toBeVisible();
  await page.getByText('Details', { exact: true }).click();
  await expect(page.getByText('Six packs remain.')).toBeVisible();
  await page.getByLabel('Supporting organisation').selectOption('partner');
  await page.getByLabel('Unit', { exact: true }).selectOption('packs');
  await page.getByLabel('Quantity', { exact: true }).fill('6');
  await page
    .getByLabel('Operational need')
    .fill('Additional packs for the shelter supply cupboard.');
  await page.getByRole('button', { name: 'Send supply request' }).click();
  await expect(page.getByText('SUP-1002', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('supply.png'), fullPage: true });
});

test('shows overview errors, empty state and mobile layout without horizontal page overflow', async ({
  page,
}, testInfo) => {
  const { failOverview, clearShelters } = await mockShelterApi(page);
  failOverview(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff?role=ShelterAdmin');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  failOverview(false);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('table', { name: 'Assigned shelters' })).toBeVisible();
  const sizes = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(sizes[0]).toBe(sizes[1]);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const workspaceNav = page.getByRole('navigation', { name: 'Workspace navigation' });
  await expect(workspaceNav.getByRole('link', { name: 'Shelter management' })).toBeInViewport();
  await expect(workspaceNav.getByRole('link', { name: /add.*shelter/i })).toHaveCount(0);
  clearShelters();
  await page.reload();
  await expect(page.getByText('No shelters registered in your assignment')).toBeVisible();
});
