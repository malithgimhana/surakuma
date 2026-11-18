import { expect, test } from '@playwright/test';

const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;

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
    await citizen.getByRole('button', { name: 'Continue', exact: true }).click();
    await citizen.getByLabel('Crisis event', { exact: true }).selectOption({ label: 'Kelani River flood response' });
    await citizen.getByLabel('Describe what you need').fill('Synthetic household urgently needs twenty litres of clean drinking water.');
    await citizen.getByLabel('Measurement unit', { exact: true }).selectOption('l');
    await citizen.getByLabel('Quantity needed', { exact: true }).fill('20');
    await citizen.getByRole('button', { name: 'Continue', exact: true }).click();
    await citizen.getByLabel('Administrative region', { exact: true }).selectOption({ index: 1 });
    await citizen.getByLabel('Location', { exact: true }).fill('Synthetic drinking water collection point');
    await citizen.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(citizen.getByText('20 L', { exact: true })).toBeVisible();
    await citizen.getByLabel('This request contains fictional information only.').check();
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

    const page = await context.newPage();
    await login(page, 'logistics', '/staff');
    await page.goto('/staff/resources');
    await page.getByRole('button', { name: 'Add resource', exact: true }).click();
    await page.getByRole('button', { name: 'Register a depot', exact: true }).click();
    await page.getByLabel('Organisation', { exact: true }).selectOption({ label: 'Surakuma Community Response (demo)' });
    await page.getByLabel('Depot name').fill(inventoryName + ' depot');
    await page.getByLabel('Depot location').fill('Synthetic Colombo depot');
    await page.getByRole('button', { name: 'Save depot' }).click();
    await page.getByRole('button', { name: 'Add resource', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add resource' });
    await dialog.getByLabel('Depot', { exact: true }).selectOption({ label: inventoryName + ' depot' });
    await dialog.getByLabel('Resource name').fill(inventoryName);
    await dialog.getByLabel('Category', { exact: true }).selectOption('FoodWater');
    await dialog.getByLabel('Unit', { exact: true }).selectOption(stockUnit);
    await dialog.getByLabel('Opening stock').fill(String(stock));
    await dialog.getByLabel('Latitude', { exact: true }).fill('6.92');
    await dialog.getByLabel('Longitude', { exact: true }).fill('79.9');
    await dialog.getByRole('button', { name: 'Save resource' }).click();
    await expect(page.getByRole('rowheader', { name: new RegExp(inventoryName) })).toBeVisible();
    await page.goto(`/staff/cases/${aid.id}`);
    await expect(page.getByText(/15 l available for 20 l outstanding/)).toBeVisible();
    await expect(page.getByText(/5 L would remain after reserving/)).toBeVisible();
    await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue(String(stock));
    await page.getByRole('button', { name: 'Approve reservation' }).click();
    await expect(page.getByText('5 L outstanding after existing commitments.')).toBeVisible();
    await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm delivery', exact: true }).click();
    await page.getByLabel('Delivery reference').fill(`MEASUREMENT-${aid.reference}`);
    await page.getByLabel('Receiving person or representative').fill('Synthetic receiving representative');
    await page.getByRole('button', { name: 'Record receipt', exact: true }).click();
    await expect(page.getByText('15 / 20 L', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('15 / 20 L', { exact: true })).toBeVisible();
    await expect(page.getByText('5 L outstanding after existing commitments.')).toBeVisible();
  });
}
