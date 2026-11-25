import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD ?? (JSON.parse(
  readFileSync(new URL('../../backend/data/development-settings.json', import.meta.url), 'utf8'),
) as { Seed: { Password: string } }).Seed.Password;
test('mobile citizen form supports three languages and accessible fields', async ({ page }, run) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('citizen@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('/app');
  await page.getByRole('link', { name: 'Request assistance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What do you need help with?' })).toBeVisible();
  for (const language of ['si', 'ta', 'en']) {
    await page.getByRole('combobox', { name: /^(Language|භාෂාව|மொழி)$/ }).selectOption(language);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.getByRole('radio', { name: /^Food & water/ }).press('Space');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Describe what you need', { exact: true })).toBeVisible();
  const picker = page.getByRole('combobox', { name: /^(Language|භාෂාව|மொழி)$/ });
  for (const [language, question, water] of [
    ['si', 'ඔබට අවශ්‍ය ද්‍රව්‍යය කුමක්ද?', 'පානීය ජලය'],
    ['ta', 'உங்களுக்கு எந்தப் பொருள் தேவை?', 'குடிநீர்'],
  ]) {
    await picker.selectOption(language);
    await expect(page.getByLabel(question).getByRole('option', { name: water })).toHaveCount(1);
    await page.screenshot({ path: run.outputPath(`citizen-intake-${language}.png`), fullPage: true });
  }
  await picker.selectOption('en');
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  await page.screenshot({ path: run.outputPath('citizen-form-375.png'), fullPage: true });
  await page.getByLabel('Crisis event').selectOption({ index: 1 });
  await page.getByLabel('Which item do you need?').selectOption('DryRations');
  await page.getByLabel('When will it run out?').selectOption('WithinDay');
  await page.getByLabel('Describe what you need').fill('Synthetic request to check draft photo handling.');
  await page.getByLabel('Measurement unit').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel('Measurement unit')).toHaveValue('pieces');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText(/Photos are not saved in the draft/)).toBeVisible();
  await page.getByLabel('Supporting photo (optional)').setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await page.reload();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Supporting photo (optional)')).toHaveValue('');
  await expect(page.getByText(/Photos are not saved in the draft/)).toBeVisible();
});
