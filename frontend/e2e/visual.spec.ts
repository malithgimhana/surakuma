import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('responsive public layouts and core accessibility', async ({ page }) => {
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `../docs/screenshots/home-${width}.png`, fullPage: true });
  }
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByLabel('Language', { exact: true }).selectOption('ta');
  await expect(page.getByRole('heading').first()).toContainText('இன்று');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '../docs/screenshots/home-tamil-375.png', fullPage: true });
});
