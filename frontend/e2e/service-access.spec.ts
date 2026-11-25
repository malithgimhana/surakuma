import { expect, test, type Page } from '@playwright/test';

const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
test.skip(!password, 'Requires the isolated Surakuma acceptance database.');
test.use({ timezoneId: 'UTC' });

async function signIn(page: Page, account: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(account + '@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

test('help me choose suggests a category and carries the description into the form', async ({ page }) => {
  await signIn(page, 'citizen');
  await page.goto('/app/requests/new');
  const categoryCards = page.locator('.category-options');
  await expect(categoryCards.getByRole('radio')).toHaveCount(6);
  await expect(categoryCards.locator('input:checked')).toHaveCount(0);
  await expect(categoryCards.locator('.selected')).toHaveCount(0);
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(next).toBeDisabled();
  await page.getByText('Help me choose with AI', { exact: true }).click();
  const description = 'I ran out of my regular medicine after the flood.';
  await page.getByLabel('Describe the help you need').fill(description);
  const suggestionRequest = page.waitForRequest(request => request.method() === 'POST' &&
    request.url().endsWith('/api/v1/requests/category-suggestion'));
  await page.getByRole('button', { name: 'Suggest a category' }).click();
  expect((await suggestionRequest).postDataJSON()).toMatchObject({ description, countryCode: 'LK', useDescriptionWithAi: true });
  await expect(page.getByRole('status').filter({ hasText: 'Suggested category:' })).toContainText(/medicine|medical/i);
  await expect(page.getByText('Suggestion from Surakuma’s local guidance')).toBeVisible();
  await expect(categoryCards.locator('input:checked')).toHaveCount(0);
  await expect(next).toBeDisabled();
  await page.getByRole('button', { name: /^Use .*medicine|^Use .*medical/i }).click();
  await expect(page.getByRole('heading', { name: 'Details', exact: true })).toBeVisible();
  await expect(page.locator('textarea[name="description"]')).toHaveValue(description);
});

test('help me choose recognises Sinhala food and water needs when the API route is unavailable', async ({ page }) => {
  await signIn(page, 'citizen');
  await page.route('**/api/v1/requests/category-suggestion', route => route.fulfill({ status: 405 }));
  await page.goto('/app/requests/new');
  await page.getByText('Help me choose with AI', { exact: true }).click();
  const description = 'අපිට කන්න බොන්න නෑ. ඉක්මනට මොනවහරි කරන්න.';
  await page.getByLabel('Describe the help you need').fill(description);
  await page.getByRole('button', { name: 'Suggest a category' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Suggested category:' })).toContainText('Food & water');
  await expect(page.getByText('Suggestion from Surakuma’s local guidance')).toBeVisible();
  await page.getByRole('button', { name: 'Use Food & water' }).click();
  await expect(page.locator('textarea[name="description"]')).toHaveValue(description);
});

test('service access publishes a centre and sends a citizen to the correct form', async ({ page, browser, baseURL }) => {
  const name = 'Acceptance assistance centre ' + Date.now();
  await signIn(page, 'admin');
  await page.goto('/admin/assistance-centres');
  await page.getByRole('button', { name: 'Register centre' }).click();
  await expect(page.getByLabel('Verified organisation').locator('option').nth(1)).toBeAttached();
  await page.getByLabel('Verified organisation').selectOption({ index: 1 });
  await page.getByLabel('Centre name').fill(name);
  await page.getByLabel('Public address').fill('Synthetic training address');
  await page.getByLabel('Latitude').fill('6.902');
  await page.getByLabel('Longitude').fill('79.868');
  await page.getByLabel('Available services').fill('Medicine collection');
  await page.getByLabel('Accessible facilities').check();
  await page.getByLabel('Approve and publish this listing').check();
  await page.getByRole('button', { name: 'Save centre' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  const citizen = await browser.newPage({ baseURL });
  try {
    await citizen.goto('/assistance-centres');
    await expect(citizen.getByRole('heading', { name })).toBeVisible();
    await citizen.getByLabel('Filter by service').fill('shelter');
    await expect(citizen.getByRole('heading', { name })).toHaveCount(0);
    await signIn(citizen, 'citizen');
    await citizen.goto('/app/help');
    await citizen.getByLabel('Your question').fill('Where can I request medicine?');
    await citizen.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(citizen.getByText('Official Surakuma guidance')).toBeVisible();
    await citizen.getByRole('link', { name: 'Open this page' }).click();
    await expect(citizen).toHaveURL(/category=Medical/);
    await expect(citizen.locator('input[value="Medical"]')).toBeChecked();
  } finally { await citizen.close(); }
});

test('service access saves a volunteer availability window through the profile', async ({ page }) => {
  await signIn(page, 'volunteer');
  await page.goto('/volunteer/profile');
  const start = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const end = new Date(Date.now() + 90000000).toISOString().slice(0, 16);
  await page.getByLabel('Available from').fill(start);
  await page.getByLabel('Available until').fill(end);
  await page.getByRole('button', { name: 'Add availability' }).click();
  await expect(page.getByText('Availability updated.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Remove availability starting/ })).toBeVisible();
  await page.getByRole('button', { name: /Remove availability starting/ }).click();
  await expect(page.getByText(/Availability unknown/)).toBeVisible();
});
