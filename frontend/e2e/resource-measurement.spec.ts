import { caseItemQuantity, fulfillStock } from './fulfill-stock';
import { expect, test } from '@playwright/test';

const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;

test('shows category-specific resource units in the logistics inventory', async ({ page }) => {
  test.skip(!password, 'Run with the isolated acceptance database and its generated credentials.');
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('logistics@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('link', { name: 'Resources & logistics', exact: true }).click();
  await page.getByRole('button', { name: 'Add resource', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add resource' });
  const category = dialog.getByLabel('Category', { exact: true });
  const unit = dialog.getByLabel('Unit', { exact: true });
  const options = unit.locator('option');
  await expect(unit).toHaveValue('');
  await expect(options).toHaveText([
    'Select a unit', 'Pieces', 'Packs', 'Kilograms (kg)', 'Grams (g)', 'Litres (L)',
    'Millilitres (mL)', 'Bags', 'Bottles', 'Cartons', 'Kits',
  ]);
  for (const [categoryCode, expected] of [
    ['Medical', ['Select a unit', 'Pieces', 'Packs', 'Litres (L)', 'Millilitres (mL)', 'Bottles', 'Boxes', 'Vials', 'Ampoules', 'Kits']],
    ['Shelter', ['Select a unit', 'Pieces', 'Packs', 'Sets', 'Rolls', 'Kits']],
    ['Transportation', ['Select a unit', 'Pieces', 'Litres (L)', 'Sets', 'Kits']],
    ['Accessibility', ['Select a unit', 'Pieces', 'Packs', 'Sets', 'Pairs', 'Kits']],
    ['Other', ['Select a unit', 'Pieces', 'Packs', 'Kilograms (kg)', 'Litres (L)', 'Bags', 'Bottles', 'Cartons', 'Boxes', 'Sets', 'Pairs', 'Kits']],
  ] as const) {
    await dialog.getByLabel('Resource name', { exact: true }).selectOption('custom');
    await unit.selectOption('pieces');
    await category.selectOption(categoryCode);
    await expect(unit).toHaveValue('');
    await expect(options).toHaveText([...expected]);
  }
});

for (const { stockUnit, stock } of [{ stockUnit: 'l', stock: 15 }, { stockUnit: 'ml', stock: 15000 }]) {
  test(`20 L request leaves 5 L outstanding after delivering stock recorded in ${stockUnit}`, async ({ page: citizen, context, request }) => {
    test.skip(!password, 'Run with the isolated acceptance database and its generated credentials.');
    const api = 'https://localhost:7143/api/v1';
    const inventoryName = `Synthetic ${stockUnit} water ${Date.now()}`;

    const login = async (page: typeof citizen, role: string, destination: string) => {
      await page.goto('/login');
      await page.getByLabel('Email address', { exact: true }).fill(`${role}@surakuma.test`);
      await page.getByLabel('Password', { exact: true }).fill(password!);
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await page.waitForURL(destination);
    };
    await login(citizen, 'citizen', '/app');
    await citizen.goto('/app/requests/new');
    await citizen.getByRole('radio', { name: /^Food & water/ }).press('Space');
    await citizen.getByRole('button', { name: 'Continue', exact: true }).click();
    await citizen.getByLabel('Crisis event', { exact: true }).selectOption({ label: 'Kelani River flood response' });
    await citizen.getByLabel('Which item do you need?').selectOption('Water');
    await citizen.getByLabel('When will it run out?').selectOption('Out');
    await citizen.getByLabel('Describe what you need').fill('Synthetic household urgently needs twenty litres of clean drinking water.');
    await citizen.getByLabel('Measurement unit', { exact: true }).selectOption('l');
    await citizen.getByLabel('Quantity needed', { exact: true }).fill('20');
    await citizen.getByRole('button', { name: 'Continue', exact: true }).click();
    await citizen.getByLabel('Administrative region', { exact: true }).selectOption({ index: 1 });
    await citizen.getByLabel('Location', { exact: true }).fill('Synthetic drinking water collection point');
    await citizen.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(citizen.getByRole('listitem').filter({ hasText: 'Drinking water · 20 L' })).toBeVisible();
    const submission = citizen.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/requests'));
    await citizen.getByRole('button', { name: 'Submit request', exact: true }).click();
    const result = await submission;
    expect(result.status()).toBe(201);
    const aid = await result.json();
    expect(aid).toMatchObject({ unit: 'l', quantity: 20, administrativeDivisionId: expect.any(String) });
    await citizen.waitForURL(`/app/requests/${aid.id}`);
    await expect(citizen.getByRole('status').filter({ hasText: 'Your request has been received' })).toBeVisible();
    await citizen.close();
    await context.clearCookies();

    const staff = await request.post(api + '/auth/login', { data: { email: 'case@surakuma.test', password } });
    expect(staff.ok()).toBeTruthy();
    const manager = { Authorization: 'Bearer ' + (await staff.json()).accessToken };
    for (const status of ['UnderReview', 'Verified', 'Approved']) {
      const statusResponse = await request.patch(`${api}/requests/${aid.id}/status`, {
        headers: manager, data: { status, reason: 'Synthetic acceptance workflow.' },
      });
      expect(statusResponse.ok()).toBeTruthy();
    }
    const items = await request.put(`${api}/fulfillment/cases/${aid.id}/items`, {
      headers: manager,
      data: { items: [{ name: 'Drinking water', category: 'FoodWater', unit: 'l', requiredQuantity: 20, approvedQuantity: 20 }] },
    });
    await expect(items).toBeOK();

    const coordinator = await request.post(api + '/auth/login', { data: { email: 'coordinator@surakuma.test', password } });
    expect(coordinator.ok()).toBeTruthy();
    const headers = { Authorization: 'Bearer ' + (await coordinator.json()).accessToken };
    const dispatchPath = `${api}/fulfillment/cases/${aid.id}`;
    const plan = await (await request.get(`${dispatchPath}/dispatches`, { headers })).json();
    const receivingCentre = await request.put(`${dispatchPath}/handover-centre`, { headers, data: { centreId: plan.centres[0].id } });
    expect(receivingCentre.ok()).toBeTruthy();
    const handoff = await request.post(`${api}/fulfillment/cases/${aid.id}/authorize`, {
      headers,
      data: { reason: 'Confirmed quantity and unit for delivery.' },
    });
    expect(handoff.ok()).toBeTruthy();

    const page = await context.newPage();
    await login(page, 'logistics', '/staff');
    await page.goto('/staff/resources');
    await page.getByRole('button', { name: 'Add resource', exact: true }).click();
    await page.getByRole('button', { name: 'Register a depot', exact: true }).click();
    await page.getByLabel('Organisation', { exact: true }).selectOption({ label: 'Surakuma Community Response (demo)' });
    await page.getByLabel('Depot name').fill(inventoryName + ' depot');
    await page.getByLabel('Depot location').fill('Synthetic Colombo depot');
    await page.getByRole('button', { name: 'Save depot' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add resource' });
    await dialog.getByLabel('Depot', { exact: true }).selectOption({ label: inventoryName + ' depot' });
    await dialog.getByLabel('Category', { exact: true }).selectOption('FoodWater');
    await dialog.getByLabel('Resource name', { exact: true }).selectOption('custom');
    await dialog.getByLabel('Custom resource name', { exact: true }).fill(inventoryName);
    await dialog.getByLabel('Unit', { exact: true }).selectOption(stockUnit);
    await dialog.getByLabel('Opening stock').fill(String(stock));
    await dialog.getByLabel('Latitude', { exact: true }).fill('6.92');
    await dialog.getByLabel('Longitude', { exact: true }).fill('79.9');
    await dialog.getByRole('button', { name: 'Save resource' }).click();
    await expect(page.getByRole('rowheader', { name: new RegExp(inventoryName) })).toBeVisible();
    await page.goto(`/staff/cases/${aid.id}`);
    await expect(caseItemQuantity(page, 'Awaiting allocation')).toHaveText('20 L');
    await fulfillStock(page, request, aid.id, 'Drinking water', inventoryName, stockUnit === 'l' ? 'L' : 'mL', stock);
    await expect(caseItemQuantity(page, 'Delivered')).toHaveText('15 L');
    await page.reload();
    await expect(caseItemQuantity(page, 'Delivered')).toHaveText('15 L');
    await expect(caseItemQuantity(page, 'Awaiting allocation')).toHaveText('5 L');
  });
}
