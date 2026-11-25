import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD ?? (JSON.parse(
  readFileSync(new URL('../../backend/data/development-settings.json', import.meta.url), 'utf8'),
) as { Seed: { Password: string } }).Seed.Password;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('citizen@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Amara' })).toBeVisible();
}

async function continueRequest(page: Page) {
  const button = page.getByRole('main').getByRole('button', { name: 'Continue', exact: true });
  await expect(button).toBeEnabled();
  await button.press('Enter');
}

async function startFoodDraft(page: Page) {
  await page.goto('/app/requests/new');
  await page.getByRole('radio', { name: /^Food & water/ }).press('Space');
  await continueRequest(page);
  await page.getByLabel('Crisis event').selectOption({ label: 'Kelani River flood response' });
  await page.getByLabel('Which item do you need?').selectOption('DryRations');
  await page.getByLabel('When will it run out?').selectOption('WithinDay');
  await page.getByLabel('Describe what you need').fill('Synthetic food draft to verify that the shelter shortcut preserves existing work.');
  await page.getByLabel('Measurement unit').selectOption('packs');
}

for (const width of [320, 375, 390, 768, 1280]) {
  test(`Citizen layout, drawer and wizard focus at ${width}px`, async ({ page }, run) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    const main = page.getByRole('main');
    const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
    if (width <= 850) {
      await page.getByRole('link', { name: 'Skip to main content' }).focus();
      await page.keyboard.press('Tab');
      await expect(toggle).toBeFocused();
      await expect(page.locator('#workspace-sidebar')).toHaveAttribute('inert', '');
      await toggle.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Workspace navigation' });
      await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
      await expect(page.locator('.workspace-main')).toHaveAttribute('inert', '');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(toggle).toBeFocused();
    } else {
      await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
      await expect(page.locator('#workspace-sidebar')).not.toHaveAttribute('inert', '');
    }
    await expect(main.getByRole('heading', { name: 'Request status overview' })).toBeVisible();
    await expect(main.getByText('Active requests', { exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Recent notifications' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Emergency alerts' })).toBeVisible();
    await page.screenshot({ path: run.outputPath(`overview-${width}-light.png`), fullPage: true });
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: run.outputPath(`overview-${width}-dark.png`), fullPage: true });
    await main.getByRole('link', { name: 'Request assistance', exact: true }).click();
    await main.getByRole('radio', { name: /^Food & water/ }).press('Space');
    await continueRequest(page);
    const heading = main.getByRole('heading', { name: 'Details', exact: true });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await continueRequest(page);
    await expect(main.getByLabel('Crisis event')).toBeFocused();
    await main.getByRole('button', { name: 'Back', exact: true }).press('Enter');
    await expect(main.getByRole('heading', { name: 'What do you need help with?' })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: run.outputPath(`request-type-${width}.png`), fullPage: true });
  });
}

test('Shelter shortcut offers both drafts, preserves the food draft and isolates country changes', async ({ page }, run) => {
  await signIn(page);
  await startFoodDraft(page);
  await page.goto('/app/shelters');
  const shelter = page.getByRole('link', { name: 'View details · Riverside Community Centre' });
  await shelter.click();
  await page.getByRole('link', { name: 'Request help', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose which request to open' })).toBeVisible();
  await page.screenshot({ path: run.outputPath('draft-choice.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue saved draft' }).click();
  await expect(page.getByRole('radio', { name: /^Food & water/ })).toBeChecked();
  await continueRequest(page);
  await expect(page.getByLabel('Describe what you need')).toHaveValue(/preserves existing work/);
  await page.goto('/app/requests/new?category=Shelter');
  await page.getByRole('button', { name: 'Open Temporary shelter' }).click();
  await expect(page.getByRole('radio', { name: /^Temporary shelter/ })).toBeChecked();
  await continueRequest(page);
  await expect(page.getByLabel('Describe your situation')).toHaveValue('');
  await page.getByLabel('Country', { exact: true }).selectOption('IN');
  await expect(page.getByRole('radio', { name: /^Temporary shelter/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Open Food & water' })).toHaveCount(0);
  await page.getByLabel('Country', { exact: true }).selectOption('LK');
  await page.getByText('Other saved drafts', { exact: true }).click();
  await page.getByRole('button', { name: 'Open Food & water' }).click();
  await continueRequest(page);
  await expect(page.getByLabel('Describe what you need')).toHaveValue(/preserves existing work/);
});

test('Request filters, shelter zero-results, alerts and profile use the workspace routes', async ({ page }, run) => {
  await signIn(page);
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  await nav.getByRole('link', { name: 'My requests', exact: true }).click();
  const status = page.getByLabel('Request status', { exact: true });
  await expect(status.locator('option')).toHaveCount(11);
  await status.selectOption('Approved');
  await expect(page.getByRole('main').getByRole('link', { name: /SK-1003/ })).toBeVisible();
  await page.screenshot({ path: run.outputPath('approved-requests.png'), fullPage: true });
  await page.getByRole('searchbox').fill('No records with this reference');
  await page.getByRole('button', { name: 'Search requests' }).click();
  await expect(page.getByRole('heading', { name: 'No matching requests' })).toBeVisible();
  await nav.getByRole('link', { name: 'Find a shelter', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/shelters$/);
  await expect(page.getByRole('heading', { name: 'Riverside Community Centre' })).toBeVisible();
  await page.screenshot({ path: run.outputPath('shelter-directory.png'), fullPage: true });
  await page.getByRole('textbox', { name: 'Search by name or area' }).fill('unmatched-shelter');
  await expect(page.getByRole('heading', { name: 'No shelters match your search' })).toBeVisible();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No shelters match your search' })).toBeVisible();
  await page.screenshot({ path: run.outputPath('no-shelters-on-map.png'), fullPage: true });
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('link', { name: /Riverside Community Centre.*spaces available/ })).toBeVisible();
  await nav.getByRole('link', { name: 'Emergency alerts', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/alerts$/);
  await expect(page.getByRole('heading', { name: 'Heavy rain expected' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Advisory', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Critical', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No alerts at this severity' })).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.screenshot({ path: run.outputPath('emergency-alerts.png'), fullPage: true });
  await nav.getByRole('link', { name: 'My profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Personal information' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Household details' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveAttribute('readonly', '');
  await page.screenshot({ path: run.outputPath('citizen-profile.png'), fullPage: true });
  const personal = page.getByRole('heading', { name: 'Personal information' });
  const household = page.getByRole('heading', { name: 'Household details' });
  expect((await household.boundingBox())!.x).toBeGreaterThan((await personal.boundingBox())!.x);
  await page.setViewportSize({ width: 320, height: 900 });
  expect((await household.boundingBox())!.y).toBeGreaterThan((await personal.boundingBox())!.y);
  await page.screenshot({ path: run.outputPath('citizen-profile-320.png'), fullPage: true });
});

test('A valid replacement photo survives real fulfilment, tracking and feedback handoffs', async ({ page, request }, run) => {
  await signIn(page);
  await startFoodDraft(page);
  await page.getByLabel('Quantity needed').fill('2');
  await page.screenshot({ path: run.outputPath('request-details.png'), fullPage: true });
  await continueRequest(page);
  await expect(page.getByRole('heading', { name: 'Location', exact: true })).toBeFocused();
  await page.getByLabel('Location', { exact: true }).fill('Synthetic Colombo community centre');
  const evidence = page.getByLabel('Supporting photo (optional)', { exact: true });
  await evidence.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('test invalid fixture') });
  await expect(page.getByText('Choose a JPEG or PNG image up to 4 MB.', { exact: true })).toBeVisible();
  await evidence.setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Choose a JPEG or PNG image up to 4 MB.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('replacement.png', { exact: true })).toBeVisible();
  await page.screenshot({ path: run.outputPath('request-location-and-evidence.png'), fullPage: true });
  await continueRequest(page);
  await expect(page.getByRole('heading', { name: 'Check your request' })).toBeFocused();
  await expect(page.getByText('replacement.png', { exact: true })).toBeVisible();
  await page.screenshot({ path: run.outputPath('request-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  const confirmation = page.getByRole('status').filter({ hasText: 'Your request has been received' });
  await expect(confirmation).toBeVisible();
  const reference = (await confirmation.innerText()).match(/SK-\d+/)?.[0];
  expect(reference).toBeTruthy();
  await expect(page.getByRole('button', { name: 'replacement.png' })).toBeVisible();
  await page.screenshot({ path: run.outputPath('submitted-request.png'), fullPage: true });
  const tracking = page.url();
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'Notifications', exact: true }).click();
  const notice = page.locator('.notification').filter({ hasText: reference! });
  await expect(notice).toBeVisible({ timeout: 35000 });
  await page.screenshot({ path: run.outputPath('citizen-notifications.png'), fullPage: true });
  await notice.getByRole('link', { name: 'View request', exact: true }).click();
  await expect(page).toHaveURL(tracking);
  const id = new URL(tracking).pathname.split('/').at(-1)!;
  const prefix = '/api/v1';
  async function roleHeaders(role: string) {
    const session = await request.post(`${prefix}/auth/login`, { data: { email: `${role}@surakuma.test`, password } });
    expect(session.ok()).toBe(true);
    return { Authorization: `Bearer ${(await session.json()).accessToken}` };
  }
  async function operation(path: string, headers: Record<string, string>, data?: object, method: 'post' | 'patch' = 'post') {
    const response = await request[method](prefix + path, { headers, data });
    expect(response.ok(), `${method} ${path} ${response.status()} ${await response.text()}`).toBe(true);
    return response;
  }
  const manager = await roleHeaders('case');
  const coordinator = await roleHeaders('coordinator');
  const logistics = await roleHeaders('logistics');
  const caseUrl = `/requests/${id}`;
  const managerQueue = await request.get(`${prefix}/requests?staffRole=CaseManager&assignedToMe=true&search=${reference}`, { headers: manager });
  expect((await managerQueue.json()).items.map((entry: { id: string }) => entry.id)).toContain(id);
  for (const status of ['UnderReview', 'Verified', 'Approved']) {
    await operation(`${caseUrl}/status`, manager, { status, reason: 'Reviewed synthetic browser case.' }, 'patch');
  }
  const approved = await (await request.get(prefix + caseUrl, { headers: manager })).json();
  expect(approved.request).toMatchObject({ status: 'Approved', category: 'FoodWater', quantity: 2, unit: 'packs' });
  await operation(`/fulfillment/cases/${id}/authorize`, coordinator, { reason: 'Coordinator checked the synthetic handoff.' });
  const stock = await (await operation('/resources', logistics, {
    organisationId: approved.request.organisationId, name: `Synthetic QA stock ${reference}`, category: 'FoodWater',
    unit: 'packs', stock: 2, locationText: 'Synthetic Colombo depot', latitude: 6.92, longitude: 79.88,
    suitability: 'Synthetic packages', transportAvailable: true,
  })).json();
  async function deliverOnePack() {
    const allocation = await (await operation('/allocations', logistics, { requestId: id, resourceId: stock.id, quantity: 1 })).json();
    await operation(`/fulfillment/allocations/${allocation.id}/prepare`, logistics, { packedQuantity: 1, note: 'Counted synthetic package.' });
    await operation(`/allocations/${allocation.id}/Dispatch`, logistics);
    await operation(`/allocations/${allocation.id}/Deliver`, logistics, {
      reference: `QA-${allocation.id}`, confirmedQuantity: 1, receivedBy: 'Synthetic recipient', method: 'RecipientAcknowledgment',
    });
  }
  await deliverOnePack();
  await page.reload();
  await expect(page.getByText('Partially delivered', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('1 / 2 packs', { exact: true })).toBeVisible();
  await page.screenshot({ path: run.outputPath('citizen-partial-delivery.png'), fullPage: true });
  await deliverOnePack();
  await operation(`${caseUrl}/status`, manager, { status: 'Closed', reason: 'Confirmed both synthetic packs arrived.' }, 'patch');
  await page.reload();
  await expect(page.getByText('2 / 2 packs', { exact: true })).toBeVisible();
  await page.getByLabel('I need to report a problem').check();
  await page.getByLabel('Your comments').fill('Synthetic feedback for staff follow-up.');
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByText('Thank you. Your feedback has been recorded.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Thank you. Your feedback has been recorded.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send feedback' })).toHaveCount(0);
  const followUps = await request.get(`${prefix}/requests?staffRole=CaseManager&view=follow-ups&assignedToMe=true&search=${reference}`, { headers: manager });
  expect((await followUps.json()).items.map((entry: { id: string }) => entry.id)).toContain(id);
  await operation(`${caseUrl}/escalation/resolve`, manager, { note: 'Synthetic feedback reviewed and resolved.' });
  await page.screenshot({ path: run.outputPath('feedback-persisted.png'), fullPage: true });
});

test('Citizen workspace text follows the supported language choices', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page);
  const language = page.getByRole('combobox', { name: /^(Language|භාෂාව|மொழி|भाषा)$/ });
  const country = page.getByLabel('Country', { exact: true });
  for (const [locale, name] of [['si', 'සක්‍රිය ඉල්ලීම්'], ['ta', 'செயலில் உள்ள கோரிக்கைகள்'], ['en', 'Active requests']]) {
    await language.selectOption(locale);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await country.selectOption('NP');
  await language.selectOption('ne');
  await expect(page.getByText('सक्रिय अनुरोधहरू', { exact: true })).toBeVisible();
  await country.selectOption('IN');
  await language.selectOption('hi');
  await expect(page.getByText('सक्रिय अनुरोध', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
