import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
const settings = JSON.parse(
  readFileSync(new URL('../../backend/data/development-settings.json', import.meta.url), 'utf8'),
) as { Seed: { Password: string } };
test('mobile citizen form supports three languages and accessible fields', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('citizen@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(settings.Seed.Password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('/app');
  await page.getByRole('link', { name: 'Request assistance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What do you need help with?' })).toBeVisible();
  for (const language of ['si', 'ta', 'en']) {
    await page.locator('select[aria-label]').first().selectOption(language);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Describe what you need', { exact: true })).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  await page.screenshot({ path: '../docs/screenshots/citizen-form-375.png', fullPage: true });
  await page.getByLabel('Crisis event').selectOption({ index: 1 });
  await page.getByLabel('Describe what you need').fill('Synthetic request to check draft photo handling.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText(/Photos are not saved in the draft/)).toBeVisible();
  await page.getByLabel('Supporting photo (optional)').setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await page.reload();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Supporting photo (optional)')).toHaveValue('');
  await expect(page.getByText(/Photos are not saved in the draft/)).toBeVisible();
});
