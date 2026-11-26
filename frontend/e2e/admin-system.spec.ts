import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('administrator sees truthful integration modes and responsive queue status', async ({
  page,
}, run) => {
  const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD ?? (JSON.parse(
    readFileSync(new URL('../../backend/data/development-settings.json', import.meta.url), 'utf8'),
  ) as { Seed: { Password: string } }).Seed.Password;
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('admin@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('/admin');
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'Integrations' }).click();
  await expect(page.getByRole('heading', { name: 'Integration readiness' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'AI recommendations' })).toContainText(
    'Deterministic fallback',
  );
  await expect(page.getByRole('region', { name: 'Email notifications' })).toContainText(
    'No email is sent.',
  );
  await expect(
    page.getByRole('region', { name: 'Location search & driving routes' }),
  ).toContainText('Unavailable');
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByRole('button', { name: 'Refresh status' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Notification queue' })).toBeVisible();
  await page.screenshot({ path: run.outputPath('admin-integrations.png') });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole('region', { name: 'AI recommendations' })).toBeVisible();
  await expect(
    page.getByText(/A configured service still needs a successful live test/),
  ).toBeVisible();
});
