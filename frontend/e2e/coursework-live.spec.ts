import { expect, test, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function signIn(browser: Browser, baseURL: string, account: string, password: string, videoDirectory?: string) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1366, height: 900 },
    recordVideo: videoDirectory ? { dir: videoDirectory } : undefined,
  });
  await context.addInitScript(() => localStorage.setItem('surakuma.country', 'LK'));
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(account + '@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible();
  return { context, page };
}
async function inspectFundingPage(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
}

test('donor and funding administrator record a pledge, verify a receipt and show reconciled totals', async ({ browser, baseURL }, run) => {
  const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD!;
  if (!password || !baseURL) throw new Error('Use the isolated SQL acceptance runner.');
  const video = process.env.SURAKUMA_DEMO_VIDEO === '1' ? run.outputPath('raw-video') : undefined;
  const admin = await signIn(browser, baseURL, 'admin', password, video);
  const donorContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, recordVideo: video ? { dir: video } : undefined });
  await donorContext.addInitScript(() => localStorage.setItem('surakuma.country', 'LK'));
  const donor = { context: donorContext, page: await donorContext.newPage() };
  const email = `donor-${crypto.randomUUID()}@surakuma.test`;
  try {
    await admin.page.goto('/admin/funding/campaigns');
    await admin.page.getByLabel('Campaign scope').selectOption({ label: 'Surakuma Community Response (demo)' });
    await admin.page.getByLabel('Campaign name').fill('Browser relief fund');
    await admin.page.getByLabel('Purpose').fill('Verified synthetic household relief.');
    await admin.page.getByLabel('Budget in local currency').fill('1000');
    await admin.page.getByRole('button', { name: 'Create campaign', exact: true }).click();
    await expect(admin.page.getByRole('heading', { name: 'Browser relief fund', exact: true })).toBeVisible();

    await donor.page.goto('/');
    await donor.page.getByRole('main').getByRole('link', { name: 'Donation', exact: true }).click();
    await donor.page.getByRole('link', { name: 'Register as a donor', exact: true }).click();
    await donor.page.getByLabel('Full name', { exact: true }).fill('Browser Donor');
    await donor.page.getByLabel('Email address', { exact: true }).fill(email);
    await donor.page.getByLabel('Password', { exact: true }).fill(password);
    await donor.page.getByLabel('Donor organisation (optional)').fill('Synthetic donor group');
    await donor.page.getByRole('button', { name: 'Register as a donor', exact: true }).click();
    await expect(donor.page).toHaveURL(/\/donor$/);
    await donor.page.goto('/app/requests/new');
    await expect(donor.page).toHaveURL(/\/donor$/);
    await donor.page.getByRole('link', { name: 'Browse all campaigns' }).click();
    await donor.page.getByRole('link', { name: 'Pledge to this campaign' }).click();
    await expect(donor.page.getByLabel('Campaign', { exact: true })).toHaveValue(/^[0-9a-f-]+$/);
    await donor.page.getByLabel('Amount', { exact: true }).fill('500');
    await donor.page.getByRole('button', { name: 'Record pledge', exact: true }).click();
    await expect(donor.page.getByText('Awaiting receipt', { exact: true })).toBeVisible();
    await donor.page.getByRole('button', { name: /dark mode/i }).click();
    await expect(donor.page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await inspectFundingPage(donor.page);
    await donor.page.screenshot({ path: run.outputPath('funding-donor-dark-mobile.png'), fullPage: true });

    await admin.page.getByRole('navigation', { name: 'Funding sections' }).getByRole('link', { name: 'Donations and pledges' }).click();
    await admin.page.getByLabel('Verified receipt reference').fill('BROWSER-SYNTHETIC-500');
    await admin.page.getByRole('button', { name: 'Verify receipt' }).click();
    await expect(admin.page.getByText('Confirmed', { exact: true })).toBeVisible();
    const adminNav = admin.page.getByRole('navigation', { name: 'Funding sections' });
    await adminNav.getByRole('link', { name: 'Fund allocations' }).click();
    await admin.page.getByLabel('Approved case').selectOption({ index: 0 });
    await admin.page.getByLabel('Amount', { exact: true }).fill('500');
    await admin.page.getByRole('button', { name: 'Record allocation' }).click();
    await expect(admin.page.getByText('Unallocated 0 LKR')).toBeVisible();
    await adminNav.getByRole('link', { name: 'Expenditures' }).click();
    await admin.page.getByLabel('Expense or fulfilment reference').fill('BROWSER-VERIFIED-EXPENSE');
    await admin.page.getByLabel('Amount', { exact: true }).fill('500');
    await admin.page.getByRole('button', { name: 'Record expenditure' }).click();
    await expect(admin.page.getByText('BROWSER-VERIFIED-EXPENSE · 500 LKR')).toBeVisible();
    await donor.page.getByRole('banner').getByRole('link', { name: 'Notifications', exact: true }).click();
    await expect(donor.page.getByText('Expenditure recorded', { exact: true })).toBeVisible();
    await donor.page.getByRole('button', { name: 'Open navigation' }).click();
    await donor.page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'Transparency reports' }).click();
    const report = donor.page.getByRole('region', { name: 'Campaign finances for Browser relief fund' });
    await expect(report.getByText('Spent', { exact: true }).locator('..')).toContainText('LKR 500');
    await expect(donor.page.getByText('BROWSER-VERIFIED-EXPENSE')).toHaveCount(0);
    await donor.page.getByRole('button', { name: 'Open navigation' }).click();
    await donor.page.getByRole('button', { name: 'Log out', exact: true }).click();
    await expect(donor.page).toHaveURL(url => url.pathname === '/');
    await donor.page.goto('/donor/reports');
    await expect(donor.page).toHaveURL(/\/donation\/login$/);
    await donor.page.getByLabel('Email address', { exact: true }).fill(email);
    await donor.page.getByLabel('Password', { exact: true }).fill(password);
    await donor.page.getByRole('button', { name: 'Donor sign-in', exact: true }).click();
    await expect(donor.page).toHaveURL(/\/donor\/reports$/);
    await expect(donor.page.getByRole('region', { name: 'Campaign finances for Browser relief fund' })).toBeVisible();
    await adminNav.getByRole('link', { name: 'Transparency reports' }).click();
    await inspectFundingPage(admin.page);
    await admin.page.screenshot({ path: run.outputPath('funding-admin-light-desktop.png'), fullPage: true });
  } finally {
    const adminRecording = admin.page.video();
    const donorRecording = donor.page.video();
    await admin.context.close();
    await donor.context.close();
    await adminRecording?.saveAs(run.outputPath('funding-administrator.webm'));
    await donorRecording?.saveAs(run.outputPath('funding-donor.webm'));
  }
});

test('funding officer manages campaigns within the assigned country', async ({ browser, baseURL, request }, run) => {
  const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
  test.skip(!password || !baseURL, 'Requires the isolated acceptance database.');
  const admin = await request.post('/api/v1/auth/login', { data: { email: 'admin@surakuma.test', password } });
  expect(admin.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await admin.json()).accessToken}` };
  const options = await request.get('/api/v1/funding/LK/options', { headers });
  expect(options.ok()).toBeTruthy();
  const scope = (await options.json()).campaignScopes.find((entry: { crisisId?: string }) => !entry.crisisId);
  const account = 'funding-' + crypto.randomUUID();
  const created = await request.post('/api/v1/admin/users', { headers, data: {
    email: account + '@surakuma.test', name: 'Synthetic funding officer', password,
    role: 'FundingOfficer', organisationId: scope.organisationId, countryCode: 'LK',
  } });
  expect(created.ok()).toBeTruthy();
  const officer = await signIn(browser, baseURL!, account, password!);
  try {
    await expect(officer.page).toHaveURL(/\/funding\/manage$/);
    await officer.page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'Campaigns', exact: true }).click();
    await officer.page.getByRole('button', { name: 'Create campaign', exact: true }).click();
    await officer.page.getByLabel('Campaign name').fill('Officer relief campaign');
    await officer.page.getByLabel('Purpose').fill('Restock household relief supplies.');
    await officer.page.getByLabel('Budget in local currency').fill('900');
    await officer.page.getByRole('button', { name: 'Create campaign' }).click();
    await expect(officer.page.getByRole('button', { name: 'Officer relief campaign', exact: true })).toBeVisible();
    await officer.page.screenshot({ path: run.outputPath('funding-officer.png') });
  } finally {
    await officer.context.close();
  }
});
