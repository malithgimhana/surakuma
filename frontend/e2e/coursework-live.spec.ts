import { expect, test, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function signIn(browser: Browser, account: string, password: string, mobile = false, videoDirectory?: string) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 },
    recordVideo: videoDirectory ? { dir: videoDirectory } : undefined,
  });
  await context.addInitScript(() => localStorage.setItem('surakuma.country', 'LK'));
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5192/login');
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

test('donor and funding administrator record a pledge, verify a receipt and show reconciled totals', async ({ browser }, run) => {
  const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD!;
  if (!password) throw new Error('Use the isolated SQL acceptance runner.');
  const video = process.env.SURAKUMA_DEMO_VIDEO === '1' ? run.outputPath('raw-video') : undefined;
  const admin = await signIn(browser, 'admin', password, false, video);
  const donor = await signIn(browser, 'citizen', password, true, video);
  try {
    await admin.page.goto('http://127.0.0.1:5192/admin/funding/campaigns');
    await admin.page.getByLabel('Campaign scope').selectOption({ label: 'Surakuma Community Response (demo)' });
    await admin.page.getByLabel('Campaign name').fill('Browser relief fund');
    await admin.page.getByLabel('Purpose').fill('Verified synthetic household relief.');
    await admin.page.getByLabel('Budget in local currency').fill('1000');
    await admin.page.getByRole('button', { name: 'Create campaign', exact: true }).click();
    await expect(admin.page.getByRole('heading', { name: 'Browser relief fund', exact: true })).toBeVisible();

    await donor.page.goto('http://127.0.0.1:5192/funding/profile');
    await donor.page.getByLabel('Donor name').fill('Browser Donor');
    await donor.page.getByLabel('Donor organisation (optional)').fill('Synthetic donor group');
    await donor.page.getByRole('button', { name: 'Register as donor' }).click();
    await expect(donor.page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    const nav = donor.page.getByRole('navigation', { name: 'Funding sections' });
    const donations = nav.getByRole('link', { name: 'Donations and pledges' });
    await donations.focus();
    await donor.page.keyboard.press('Enter');
    await donor.page.getByLabel('Campaign', { exact: true }).selectOption({ label: 'Browser relief fund (LKR)' });
    await donor.page.getByLabel('Amount', { exact: true }).fill('500');
    await donor.page.getByRole('button', { name: 'Record pledge', exact: true }).click();
    await expect(donor.page.getByText('Pledged', { exact: true })).toBeVisible();
    await donor.page.getByRole('button', { name: 'Dark mode' }).click();
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
    await nav.getByRole('link', { name: 'Notifications', exact: true }).click();
    await expect(donor.page.getByText('Expenditure recorded', { exact: true })).toBeVisible();
    await nav.getByRole('link', { name: 'Transparency reports' }).click();
    const report = donor.page.getByRole('heading', { name: 'Browser relief fund' }).locator('..');
    await expect(report.getByText('Expended', { exact: true }).locator('..')).toContainText('500 LKR');
    await expect(donor.page.getByText('BROWSER-VERIFIED-EXPENSE')).toHaveCount(0);
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
