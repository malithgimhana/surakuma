import { expect, test } from '@playwright/test';

const workspaces = [
  ['citizen', 'Citizen', '/app'],
  ['case', 'Case Manager', '/staff'],
  ['coordinator', 'Emergency Coordinator', '/staff'],
  ['logistics', 'Logistics', '/staff'],
  ['shelter', 'Shelter Administrator', '/staff'],
  ['volunteers', 'Volunteer Coordinator', '/staff'],
  ['volunteer', 'Volunteer', '/volunteer'],
  ['donor', 'Donor', '/donor'],
  ['funding', 'Funding Officer', '/funding/manage'],
  ['partner', 'Partner', '/partner'],
  ['country-admin', 'Country Administrator', '/admin'],
  ['admin', 'System Administrator', '/admin'],
] as const;

for (const [account, role, landing] of workspaces) {
  test(`${role} workspace supports desktop, tablet and keyboard navigation on mobile`, async ({ page }, run) => {
    const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
    test.skip(!password, 'Requires the isolated Surakuma acceptance database.');
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(account === 'donor' ? '/donation/login' : '/login');
    await page.getByLabel('Email address', { exact: true }).fill(`${account}@surakuma.test`);
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: account === 'donor' ? 'Donor sign-in' : 'Log in', exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === landing);

    const main = page.getByRole('main');
    const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
    const menu = page.locator('button.mobile-menu');
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(main.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: run.outputPath(`${account}-${width}.png`) });

      if (await menu.isVisible()) {
        await menu.focus();
        await page.keyboard.press('Enter');
        await expect(navigation).toBeVisible();
        await expect(navigation.getByRole('link').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(navigation).toBeHidden();
        await expect(menu).toBeFocused();
      } else {
        await expect(navigation.getByRole('link').first()).toBeVisible();
      }
    }
  });
}
