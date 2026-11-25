import { expect, test } from '@playwright/test';

test('individual donors follow pledge status, spending and reports across their workspace', async ({ page }, run) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.addInitScript(() => {
    localStorage.setItem('surakuma.country', 'LK');
    localStorage.setItem('surakuma.theme', 'light');
  });
  const user = { id: 'donor-design', name: 'Demo Donor', email: 'demo@example.test', language: 'en', roles: ['Donor'], memberships: [] };
  const campaigns = [
    { id: 'flood', name: 'Flood Relief Fund', purpose: 'Food and household essentials for families affected by flooding.', budget: 50000 },
    { id: 'food', name: 'Community Food Support', purpose: 'Food packs for households facing shortages.', budget: 30000 },
  ].map(campaign => ({ ...campaign, open: true, currency: 'LKR' }));
  const donations = [
    { id: 'cash', campaignId: 'flood', kind: 'Monetary', unit: 'LKR', amount: 5000, state: 'Allocated', category: 'FoodWater' },
    { id: 'goods', campaignId: 'food', kind: 'Material', unit: 'packs', amount: 20, state: 'Pledged', category: 'FoodWater' },
  ];
  const createdAt = '2026-11-24T03:30:00Z';
  const data = {
    profile: { displayName: 'Demo Donor', organisationName: null }, campaigns, donations,
    allocations: [{ id: 'allocation', donationId: 'cash', amount: 5000 }],
    expenses: [{ id: 'expense', allocationId: 'allocation', amount: 3000, createdAt }],
    events: [{ id: 'posted', donationId: 'cash', activity: 'Pledged', state: 'Pledged', createdAt }],
    reports: [{ campaignId: 'flood', budget: 50000, pledged: 0, received: 12000, allocated: 8000, expended: 5000 },
      { campaignId: 'food', budget: 30000, pledged: 0, received: 1000, allocated: 0, expended: 0 }],
    materialReports: [{ campaignId: 'flood', category: 'FoodWater', unit: 'packs', received: 60, allocated: 45, distributed: 30 }],
    flags: [],
  };
  const notifications = [
    { id: 'spent', message: 'Expenditure recorded · Flood Relief Fund', createdAt, read: false, scopeRole: 'Donor' },
    { id: 'received', message: 'Pledge recorded · Community Food Support', createdAt, read: false, scopeRole: 'Donor' },
    { id: 'allocated', message: 'Donation allocated · Flood Relief Fund', createdAt, read: true, scopeRole: 'Donor' },
  ];
  const writes: unknown[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    let json: unknown = [];
    if (path === '/auth/refresh') json = { accessToken: 'test', user };
    if (path === '/countries') json = [{ code: 'LK', name: 'Sri Lanka', languages: 'en,si,ta' }];
    if (path === '/public/resource-units') json = [{ code: 'packs', label: 'Packs', allowsFractions: false, stockCategories: ['FoodWater'] }];
    if (path === '/funding/LK/workspace') json = data;
    if (path === '/funding/LK/donations' && request.method() === 'POST') {
      const pledge = request.postDataJSON();
      writes.push(pledge);
      const donation = { ...pledge, id: 'new-pledge', state: 'Pledged' };
      donations.unshift(donation);
      json = donation;
    }
    if (path === '/funding/LK/donations/goods/cancel') {
      donations.find(donation => donation.id === 'goods')!.state = 'Cancelled';
      json = {};
    }
    if (path === '/funding/profile' && request.method() === 'PUT') {
      Object.assign(data.profile, request.postDataJSON());
      json = data.profile;
    }
    if (path === '/notifications/unread-count') json = { count: notifications.filter(item => !item.read).length };
    if (path === '/notifications') json = url.searchParams.has('unreadOnly') ? notifications.filter(item => !item.read) : notifications;
    if (path === '/notifications/spent/read') { notifications[0].read = true; json = {}; }
    await route.fulfill({ json });
  });

  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  const tab = (name: string) => nav.getByRole('link', { name, exact: true });
  const capture = async (file: string) => {
    if (!process.env.SURAKUMA_FUNDING_QA) return;
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: run.outputPath(file), animations: 'disabled' });
  };

  await page.goto('/donor');
  await expect(page.getByRole('heading', { name: 'Donor overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Flood Relief Fund', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Awaiting receipt' })).toBeVisible();
  await expect.poll(() => page.locator('.donor-hero img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await capture('01-overview.png');

  await page.getByRole('link', { name: 'Browse all campaigns' }).click();
  await expect(page.getByRole('heading', { name: 'Donation campaigns', exact: true })).toBeVisible();
  const foodCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Community Food Support' }) });
  await expect.poll(() => foodCard.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await capture('02-donation-campaigns.png');
  await foodCard.getByRole('link', { name: 'Pledge to this campaign' }).click();
  await expect(page.getByRole('combobox', { name: 'Campaign', exact: true })).toHaveValue('food');
  await page.getByLabel('Donation type').selectOption('Material');
  await page.getByLabel('Inventory unit').selectOption('packs');
  await expect(page.getByRole('row').filter({ hasText: 'LKR 5,000' }).getByRole('button', { name: 'Cancel pledge' })).toHaveCount(0);
  await capture('03-donations-and-pledges.png');

  await tab('Allocations').click();
  await expect(page.getByRole('row').filter({ hasText: 'Flood Relief Fund' })).toContainText('LKR 5,000');
  await expect(page.getByText('Community Food Support · 20 packs')).toBeVisible();
  await capture('04-allocations.png');
  await tab('Distributions and spending').click();
  await expect(page.getByText('No distributions recorded yet')).toBeVisible();
  await expect(page.getByText('LKR 3,000').first()).toBeVisible();
  await capture('05-distributions-and-spending.png');
  await tab('Transparency reports').click();
  await expect(page.getByRole('region', { name: 'Campaign finances for Flood Relief Fund' })).toContainText('LKR 12,000');
  await expect(page.getByText('60 packs')).toBeVisible();
  await capture('06-transparency-reports.png');
  await page.getByRole('combobox', { name: 'Campaign', exact: true }).selectOption('food');
  await expect(page.getByRole('region', { name: 'Campaign finances for Community Food Support' })).toContainText('LKR 1,000');
  await expect(page.getByText('60 packs')).toHaveCount(0);

  await tab('Notifications').click();
  await expect(page.getByText('Expenditure recorded · Flood Relief Fund')).toBeVisible();
  await page.getByLabel('Show read notifications').check();
  await expect(page.getByText('Donation allocated · Flood Relief Fund')).toBeVisible();
  await capture('07-notifications.png');
  await page.getByRole('button', { name: 'Mark as read', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Mark as read', exact: true })).toHaveCount(1);

  await tab('Donor profile').click();
  await expect(page.getByLabel('Donor name')).toHaveValue('Demo Donor');
  await expect(page.getByLabel('Donor organisation (optional)')).toHaveValue('');
  await capture('08-donor-profile.png');
  await page.getByLabel('Donor name').fill('Individual Donor');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('heading', { name: 'Individual Donor' })).toBeVisible();

  await tab('Donations and pledges').click();
  await page.getByRole('combobox', { name: 'Campaign', exact: true }).selectOption('food');
  await page.getByLabel('Donation type').selectOption('Material');
  await page.getByLabel('Inventory unit').selectOption('packs');
  await page.getByLabel('Amount', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Record pledge' }).click();
  await expect(page.getByRole('row').filter({ hasText: '6 packs' })).toContainText('Awaiting receipt');
  expect(writes).toEqual([expect.objectContaining({ campaignId: 'food', kind: 'Material', unit: 'packs', amount: 6 })]);
  await page.getByRole('row').filter({ hasText: '20 packs' }).getByRole('button', { name: 'Cancel pledge' }).click();
  await expect(page.getByRole('row').filter({ hasText: '20 packs' })).toContainText('Cancelled');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/donor');
  await expect(page.getByRole('link', { name: 'Pledge to this campaign', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await capture('09-overview-mobile.png');
  await page.setViewportSize({ width: 900, height: 950 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
  await capture('10-overview-tablet.png');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await capture('11-overview-dark.png');
  expect(errors).toEqual([]);
});
