import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('case manager workspace follows the assigned country and supports review on desktop and mobile', async ({
  page,
  request,
}, run) => {
  test.skip(
    !process.env.SURAKUMA_ACCEPTANCE_PASSWORD && process.env.SURAKUMA_CASE_WORKSPACE_E2E !== '1',
    'Requires an isolated Surakuma development database.',
  );
  test.setTimeout(180_000);
  const password =
    process.env.SURAKUMA_ACCEPTANCE_PASSWORD ??
    (
      JSON.parse(
        readFileSync(
          new URL('../../backend/data/development-settings.json', import.meta.url),
          'utf8',
        ),
      ) as { Seed: { Password: string } }
    ).Seed.Password;
  const api = '/api/v1';
  const login = await request.post(api + '/auth/login', {
    data: { email: 'citizen@surakuma.test', password },
  });
  expect(login.ok()).toBeTruthy();
  const headers = { Authorization: 'Bearer ' + (await login.json()).accessToken };
  const lookup = await (await request.get(api + '/public/lookups?countryCode=LK')).json();
  const crisisId = lookup.crises.find(
    (crisis: { name: string }) => crisis.name === 'Kelani River flood response',
  ).id;
  const divisions = await (await request.get(api + '/countries/LK/divisions')).json();
  const region = (divisions as { id: string; name: string }[]).find(
    (item) => item.name === 'Colombo',
  );
  const description =
    'Browser test: our household needs temporary shelter with step-free access after flooding.';
  const submitted = await request.post(api + '/requests', {
    headers,
    data: {
      crisisId,
      category: 'Shelter',
      priority: 'High',
      description,
      locationText: 'Kelaniya test location',
      administrativeDivisionId: region?.id,
      quantity: 1,
      unit: 'household',
      householdSize: 4,
      accessibilityNeeds: 'Step-free access',
      latitude: 6.95,
      longitude: 79.92,
      synthetic: true,
      submissionKey: randomUUID(),
    },
  });
  expect(submitted.status()).toBe(201);
  const aid = await submitted.json();
  expect(aid.assignedCaseManagerId).toBeTruthy();
  const medical = await request.post(api + '/requests', {
    headers,
    data: {
      crisisId,
      category: 'Medical',
      priority: 'Critical',
      description: 'Browser test: a household needs two medical support kits after flooding.',
      locationText: 'Colombo test collection point',
      quantity: 2,
      unit: 'kits',
      householdSize: 2,
      accessibilityNeeds: '',
      synthetic: true,
      submissionKey: randomUUID(),
    },
  });
  expect(medical.status()).toBe(201);
  const newerAid = await medical.json();
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))
      browserErrors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('surakuma.theme', 'dark');
    localStorage.setItem('surakuma.country', 'NP');
  });
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('case@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Case Manager Overview' })).toBeVisible();
  const attentionRows = page.getByRole('region', { name: 'Cases needing attention' }).getByRole('rowheader');
  await expect(attentionRows.nth(0)).toHaveText(newerAid.reference);
  await expect(attentionRows.nth(1)).toHaveText(aid.reference);
  await expect(page.locator('header.workspace-top .workspace-country')).toHaveText(/Sri Lanka/);
  await expect(page.getByRole('combobox', { name: 'Country', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('.sidebar').hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  const capture = async (name: string, width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, 0));
    if (name === 'details-desktop') {
      // External tiles may be unavailable. Capture them once requested tiles settle when possible.
      await page
        .waitForFunction(
          () => {
            const tiles = [
              ...document.querySelectorAll<HTMLImageElement>('.cm-case-map .leaflet-tile'),
            ];
            return tiles.length > 0 && tiles.every((tile) => tile.complete);
          },
          undefined,
          { timeout: 6000 },
        )
        .catch(() => undefined);
    }
    await page.screenshot({ path: run.outputPath(name + '.png'), animations: 'disabled' });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      name,
    ).toBe(true);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target),
      })),
      name,
    ).toEqual([]);
  };
  await page.getByRole('link', { name: 'Open cases', exact: true }).click();
  await expect(page).toHaveURL(/\/staff\/cases\?role=CaseManager&view=open$/);
  await page.getByLabel('Assistance category').selectOption('Shelter');
  await expect(page).toHaveURL(/category=Shelter/);
  const row = page.getByRole('row', { name: new RegExp(aid.reference) });
  await expect(row).toBeVisible();
  await expect(row.getByText('1 household', { exact: true })).toHaveCount(2);
  if (region) await expect(page.getByLabel('Administrative region')).toBeVisible();
  await capture('queue-desktop', 1753, 897);
  await capture('queue-mobile', 390, 844);
  await row.getByRole('link', { name: `Review case ${aid.reference}` }).click();
  await expect(
    page.getByRole('heading', { name: 'Citizen Needs — Requested Assistance' }),
  ).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await expect(page.getByText('Step-free access', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve case', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Begin review' }).click();
  await page.getByRole('button', { name: 'Verify request' }).click();
  await page.getByRole('button', { name: 'Generate recommendation' }).click();
  const approveAdvice = page.getByRole('button', { name: 'Approve recommendation' });
  await expect(approveAdvice).toBeVisible();
  await approveAdvice.click();
  await expect(
    page.locator('.cm-page-header').getByText('Verified', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Approve case', exact: true }).click();
  await expect(page.getByText('Monitor fulfilment', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Case lifecycle' }).getByText('Approved'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /approve reservation|allocate shelter/i }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Monitor fulfilment', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View fulfilment summary' })).toHaveAttribute(
    'href',
    '#fulfilment',
  );
  await capture('details-desktop', 1672, 941);
  await capture('details-mobile', 390, 844);
  await page.getByRole('button', { name: 'Back to case queue' }).click();
  await expect(page).toHaveURL(/category=Shelter/);
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Citizen Needs Summary' })).toBeVisible();
  await expect(page.getByText(aid.reference, { exact: true }).first()).toBeVisible();
  await capture('overview-desktop', 1672, 941);
  await capture('overview-mobile', 390, 844);
  await page.goto('/app/profile?role=CaseManager');
  await expect(page.getByRole('heading', { name: 'Country & organisation scope' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /country|organisation/i })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveAttribute(
    'readonly',
    '',
  );
  const permissions = page.getByRole('button', { name: 'View permissions' });
  await permissions.click();
  await expect(page.getByText(/Review, verify, approve, and escalate cases/)).toBeVisible();
  await page.getByRole('button', { name: 'Hide permissions' }).click();
  await capture('profile-desktop', 1568, 1003);
  const availability = page.getByRole('checkbox', { name: /Available for new cases/ });
  await expect(availability).toBeChecked();
  await availability.uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: /saved/i })).toBeVisible();
  await page.reload();
  await expect(availability).not.toBeChecked();
  await availability.check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: /saved/i })).toBeVisible();
  await capture('profile-mobile', 390, 844);
  expect(browserErrors).toEqual([]);
});
