import { test, expect } from '@playwright/test';

test('public skip link and login controls support keyboard navigation and enlarged text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A little help today. A safer tomorrow.' }),
  ).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).focus();
  await page.keyboard.type('keyboard@example.test');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type('SyntheticKeyboardTest!9');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeFocused();
  const originalInputSize = await page
    .getByLabel('Email address', { exact: true })
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  await page.addStyleTag({ content: ':root { font-size: 32px !important; }' });
  expect(
    await page
      .getByLabel('Email address', { exact: true })
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeCloseTo(originalInputSize * 2);
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '../docs/screenshots/login-text-200.png', fullPage: true });
});
