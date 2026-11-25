import { expect, test, type Page } from '@playwright/test';

const workspace = '/funding/manage';

async function mockAccount(page: Page, roles: string[]) {
  const memberships = [{ id: 'funding-assignment', role: 'FundingOfficer', countryCode: 'LK', organisationId: 'funding-org' }];
  const user = {
    id: 'funding-account', name: 'Funding Tester', email: 'funding@example.test', language: 'en',
    roles, memberships, householdSize: 3, accessibilityNeeds: '',
  };
  const profileUpdates: unknown[] = [];
  const citizenRequests: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const { pathname } = new URL(route.request().url());
    const path = pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/refresh') json = { accessToken: 'test', user };
    if (path === '/auth/profile') {
      json = { assignments: memberships.map(assignment => ({ ...assignment, country: 'Sri Lanka', organisation: 'Response organisation' })), workPhone: null, volunteer: null };
      if (route.request().method() === 'PUT') {
        profileUpdates.push(route.request().postDataJSON());
        json = { ...user, ...route.request().postDataJSON() };
      }
    }
    if (path === '/funding/LK/workspace') json = {
      campaigns: [], donations: [], allocations: [], expenses: [], events: [], reports: [], materialReports: [], flags: [],
    };
    if (path === '/countries') json = [{ code: 'LK', name: 'Sri Lanka', languages: 'en,si,ta' }];
    if (path === '/notifications/unread-count') json = { count: 0 };
    if (path.startsWith('/requests')) {
      citizenRequests.push(path);
      if (path === '/requests/mine') json = { items: [], total: 0, pageNumber: 1, pageSize: 20 };
    }
    await route.fulfill({ json });
  });
  return { citizenRequests, profileUpdates };
}

test('funding officers stay in the shared staff layout from the sidebar and old bookmarks', async ({ page }) => {
  const { citizenRequests } = await mockAccount(page, ['FundingOfficer']);
  await page.goto(workspace);
  const sections = page.getByRole('navigation', { name: 'Workspace navigation' });
  await expect(page.getByRole('navigation', { name: 'Page navigation' }).getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await sections.getByRole('link', { name: 'My profile' }).click();
  await expect(page).toHaveURL(`${workspace}/profile`);
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Funding assignments' })).toBeVisible();
  await expect(page.getByText('Response organisation', { exact: true })).toBeVisible();
  await expect(sections.getByRole('link', { name: 'My requests' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', `${workspace}/notifications`);
  await sections.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByRole('heading', { name: 'Funding overview' })).toBeVisible();

  await page.goto('/app/profile');
  await expect(page).toHaveURL(`${workspace}/profile`);
  await page.goto('/app/notifications');
  await expect(page).toHaveURL(`${workspace}/notifications`);

  for (const path of ['/app', '/app/requests', '/app/requests/new', '/app/requests/example']) {
    await page.goto(path);
    await expect(page).toHaveURL(workspace);
  }
  expect(citizenRequests).toEqual([]);
});

test('an account with both roles keeps citizen access and saves funding contact details without household fields', async ({ page }) => {
  const { profileUpdates } = await mockAccount(page, ['FundingOfficer', 'Citizen']);

  await page.goto(`${workspace}/profile`);
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  const householdSize = page.getByRole('spinbutton', { name: 'People in your household' });
  await expect(householdSize).toHaveCount(0);
  await page.getByLabel('Full name').fill('Updated Funding Tester');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => profileUpdates).toEqual([{ name: 'Updated Funding Tester', language: 'en', workPhone: '' }]);

  await page.goto('/app/requests');
  await expect(page.getByRole('heading', { name: 'My requests' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'My profile' }).click();
  await expect(page).toHaveURL('/app/profile');
  await expect(householdSize).toHaveValue('3');
});

test('a selected campaign carries through the funding workflow and keeps material records separate', async ({ page }, run) => {
  await mockAccount(page, ['FundingOfficer']);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.emulateMedia({ colorScheme: 'light' });
  const createdAt = '2026-11-24T06:00:00Z';
  const campaigns = [
    { id: 'flood', name: 'Flood Relief', purpose: 'Emergency support for flood-affected households.', budget: 500000, open: true },
    { id: 'hills', name: 'Hill Country Support', purpose: 'Recovery support for hill country communities.', budget: 400000, open: true },
  ].map(campaign => ({ ...campaign, currency: 'LKR', organisationId: 'funding-org', createdAt }));
  const donations = [
    { id: 'pending', campaignId: 'hills', kind: 'Monetary', state: 'Pledged', donor: 'Community Fund', amount: 5000, unit: 'LKR', receiptReference: null },
    { id: 'verified', campaignId: 'hills', kind: 'Monetary', state: 'Allocated', donor: 'Recovery Fund', amount: 150000, unit: 'LKR', receiptReference: 'R-100' },
    { id: 'water', campaignId: 'hills', kind: 'Material', state: 'Allocated', donor: 'Supply Fund', amount: 300, unit: 'packs', receiptReference: 'R-101', resourceId: 'water-stock' },
  ].map(donation => ({ ...donation, category: 'FoodWater' }));
  const allocations = [
    { id: 'allocation-money', donationId: 'verified', requestId: 'case', amount: 75000 },
    { id: 'allocation-material', donationId: 'water', requestId: 'case', amount: 150 },
  ];
  const expenses: { id: string; allocationId: string; amount: number; reference: string }[] = [];
  const flags = [{ id: 'flag', donationId: 'verified', category: 'RepeatedReceipt', severity: 'Medium', evidence: 'Two donations used similar receipt references.', outcome: '', reviewedAt: '', resolution: '' }];
  const writes: { path: string; data: Record<string, unknown> }[] = [];
  await page.route('**/api/v1/funding/LK/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1/funding/LK', '');
    if (request.method() === 'GET') {
      if (path === '/options') return route.fulfill({ json: {
        campaignScopes: [{ id: 'funding-org', name: 'Response organisation', organisationId: 'funding-org' }],
        cases: [{ id: 'case', reference: 'CASE-100', category: 'FoodWater', unit: 'packs' }], resources: [],
        deliveries: [{ id: 'delivery', requestId: 'case', resourceId: 'water-stock', reference: 'DEL-100', quantity: 100, unit: 'packs' }],
      } });
      return route.fulfill({ json: { campaigns, donations, allocations, expenses, flags,
        reports: campaigns.map(campaign => ({ campaignId: campaign.id, budget: campaign.budget, pledged: donations[0].state === 'Pledged' ? 5000 : 0,
          received: campaign.id === 'hills' ? 150000 + (donations[0].receiptReference ? 5000 : 0) : 325000, allocated: 75000, expended: 0 })),
        materialReports: [{ campaignId: 'hills', category: 'FoodWater', unit: 'packs', received: 300, allocated: 150, distributed: expenses[0]?.amount ?? 0 }],
        events: [{ id: 'event', donationId: 'water', activity: 'Aid allocation recorded', state: 'Allocated', createdAt }],
      } });
    }
    const data = request.postDataJSON() ?? {};
    if (path === '/campaigns/hills' && request.method() === 'PUT') {
      if (data.budget < 100) return route.fulfill({ status: 400, json: { detail: 'The budget cannot be lower than the amount already spent.' } });
      Object.assign(campaigns[1], data);
    }
    writes.push({ path, data });
    if (path.endsWith('/confirm')) Object.assign(donations[0], { state: 'Confirmed', receiptReference: data.reference });
    if (path.endsWith('/allocations')) allocations.push({ id: data.operationId, donationId: 'pending', requestId: data.requestId, amount: data.amount });
    if (path.endsWith('/expenses')) expenses.push({ id: data.operationId, allocationId: 'allocation-material', amount: data.amount, reference: data.reference });
    if (path.endsWith('/review')) Object.assign(flags[0], { outcome: data.outcome, reviewedAt: createdAt, resolution: data.reason });
    await route.fulfill({ json: path.endsWith('/scan') ? 0 : {} });
  });

  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const tab = (name: string) => page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name, exact: true });
  const screenshot = (name: string) => page.screenshot({ path: run.outputPath(`${name}.png`), animations: 'disabled' });
  const selectedCampaign = page.getByLabel('Campaign', { exact: true });
  await page.goto(workspace);
  await expect(page.getByRole('heading', { name: 'Funding work queue' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review receipts' })).toHaveAttribute('href', `${workspace}/donations?campaign=hills&kind=money&donation=pending`);
  await screenshot('01-overview');
  await tab('Campaigns').click();
  await page.getByRole('searchbox', { name: 'Search campaigns' }).fill('Hill');
  await page.getByRole('button', { name: 'Hill Country Support', exact: true }).click();
  await expect(page.getByText('Response organisation', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search campaigns' }).clear();
  await screenshot('02-campaigns');
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByLabel('Campaign scope')).toBeVisible();
  await page.getByRole('button', { name: 'Back to campaigns' }).click();
  const editButton = page.getByRole('button', { name: 'Edit campaign Hill Country Support', exact: true });
  await editButton.click();
  const edit = page.getByRole('dialog', { name: 'Edit campaign' });
  await expect(edit.getByLabel('Campaign name')).toHaveValue('Hill Country Support');
  await expect(edit.getByLabel('Purpose')).toHaveValue('Recovery support for hill country communities.');
  await expect(edit.getByLabel('Budget in local currency')).toHaveValue('400000');
  await edit.getByLabel('Campaign name').fill('Discarded name');
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await expect(edit).toBeHidden();
  await editButton.click();
  await expect(edit.getByLabel('Campaign name')).toHaveValue('Hill Country Support');
  await edit.getByLabel('Campaign name').fill('Hill Country Recovery');
  await edit.getByLabel('Purpose').fill('Recovery supplies and shelter support.');
  await edit.getByLabel('Budget in local currency').fill('90');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit.getByRole('alert')).toHaveText('The budget cannot be lower than the amount already spent.');
  await edit.getByLabel('Budget in local currency').fill('425000');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Hill Country Recovery' })).toBeVisible();
  await expect(page.getByText('Recovery supplies and shelter support.')).toBeVisible();
  await tab('Donations').click();
  await expect(selectedCampaign).toHaveValue('hills');
  await expect(page.getByRole('heading', { name: 'Verify receipt' })).toBeVisible();
  await screenshot('03-donations');
  await page.getByLabel('Verified receipt reference').fill('REC-100');
  await page.getByRole('button', { name: 'Verify receipt' }).click();
  await expect(page.getByText('Receipt REC-100')).toBeVisible();

  await page.getByRole('link', { name: 'Allocate donation', exact: true }).click();
  await expect(selectedCampaign).toHaveValue('hills');
  await expect(page.getByLabel('Confirmed donation')).toHaveValue('pending');
  await expect(page.getByLabel('Approved case')).toBeVisible();
  await screenshot('04-allocations');
  await page.getByLabel('Amount', { exact: true }).fill('2500');
  await page.getByRole('button', { name: 'Record allocation' }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveAttribute('max', '2500');

  await tab('Spending & delivery').click();
  await page.getByRole('button', { name: 'Materials' }).click();
  await expect(page.getByLabel('Confirmed delivery')).toHaveValue('delivery');
  await expect(page.getByLabel('Amount', { exact: true })).toHaveAttribute('max', '100');
  await screenshot('05-spending');
  await page.getByLabel('Expense or fulfilment reference').fill('DEL-REF');
  await page.getByLabel('Amount', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Record fulfilment' }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveAttribute('max', '70');

  await tab('Reports').click();
  await expect(page.getByRole('cell', { name: '80 packs' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Money' }).click();
  await expect(page.getByRole('heading', { name: 'Funding progress — Hill Country Recovery (LKR)' })).toBeVisible();
  await expect(page.getByText('LKR 425,000')).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(3);
  await screenshot('06-reports');

  await tab('Activity').click();
  await expect(page.getByText('Aid allocation recorded')).toBeVisible();
  await screenshot('07-activity');
  await page.getByRole('link', { name: 'View donation' }).click();
  await expect(page.getByRole('button', { name: 'Materials' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Receipt R-101')).toBeVisible();

  await tab('Investigations').click();
  await expect(page.getByRole('button', { name: 'Review Repeated Receipt' })).toBeVisible();
  await screenshot('08-investigations');
  await page.getByRole('button', { name: 'Scan campaign ledger' }).click();
  await expect(page.getByRole('status')).toHaveText('Ledger scan complete. 0 new flags.');
  await page.getByRole('button', { name: 'Review Repeated Receipt' }).click();
  await expect(page.getByText('Two donations used similar receipt references.')).toBeVisible();
  await page.getByLabel('Review reason').fill('Receipt records compared.');
  await page.getByRole('button', { name: 'Record investigation decision' }).click();
  await expect(page.getByText(/Dismissed · Receipt records compared/)).toBeVisible();

  await tab('My profile').click();
  await expect(page.getByRole('heading', { name: 'Account details' })).toBeVisible();
  await screenshot('09-profile');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await tab('Overview').click();
  await expect(page.getByRole('heading', { name: 'Funding work queue' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await screenshot('10-overview-mobile');
  expect(writes.map(item => item.path)).toEqual(['/campaigns/hills', '/donations/pending/confirm', '/donations/pending/allocations',
    '/allocations/allocation-material/expenses', '/campaigns/hills/scan', '/investigations/flag/review']);
  expect(writes[0].data).toEqual({ name: 'Hill Country Recovery', purpose: 'Recovery supplies and shelter support.', budget: 425000 });
  expect(writes[3].data).toMatchObject({ deliveryConfirmationId: 'delivery', amount: 80, reference: 'DEL-REF' });
  expect(errors).toEqual([]);
});
