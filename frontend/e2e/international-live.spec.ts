import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('real three-country submission, scoped triage, allocation and delivery', async ({
  browser,
  request,
}) => {
  const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
  if (!password)
    throw new Error(
      'Run via scripts/Test-InternationalAcceptance.ps1, never against the live database.',
    );
  const api = 'https://localhost:7143/api/v1';
  const login = await request.post(api + '/auth/login', {
    data: { email: 'admin@surakuma.test', password },
  });
  expect(login.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const lookup = await (await request.get(api + '/public/lookups')).json();
  const organisationId = lookup.organisations[0].id;
  const incident = await (
    await request.post(api + '/incidents', {
      headers,
      data: { name: 'Three-country acceptance incident' },
    })
  ).json();
  const cases: { id: string; country: string }[] = [];
  for (const [countryCode, latitude, longitude] of [
    ['LK', 6.93, 79.88],
    ['NP', 27.7, 85.3],
    ['IN', 28.6, 77.2],
  ] as const) {
    expect(
      (
        await request.put(`${api}/admin/organisations/${organisationId}/countries/${countryCode}`, {
          headers,
        })
      ).ok(),
    ).toBeTruthy();
    const crisis = await (
      await request.post(api + '/crises', {
        headers,
        data: {
          countryCode,
          name: `Acceptance ${countryCode}`,
          type: 'Flood',
          latitude,
          longitude,
          active: true,
        },
      })
    ).json();
    expect(
      (
        await request.put(`${api}/crises/${crisis.id}/centre`, {
          headers,
          data: { organisationId },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (await request.put(`${api}/incidents/${incident.id}/crises/${crisis.id}`, { headers })).ok(),
    ).toBeTruthy();
    const email = `scope-${countryCode.toLowerCase()}@acceptance.test`;
    expect(
      (
        await request.post(api + '/admin/users', {
          headers,
          data: {
            email,
            password,
            name: `${countryCode} scoped coordinator`,
            organisationId,
            role: 'Coordinator',
            countryCode,
            crisisId: crisis.id,
          },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await request.post(api + '/resources', {
          headers,
          data: {
            organisationId,
            countryCode,
            name: `${countryCode} food`,
            category: 'FoodWater',
            unit: 'packs',
            stock: 20,
            locationText: 'Acceptance depot',
            latitude,
            longitude,
            suitability: 'Food packs',
            transportAvailable: true,
          },
        })
      ).ok(),
    ).toBeTruthy();
    const citizenContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
    });
    await citizenContext.addInitScript(
      (c) => localStorage.setItem('surakuma.country', c),
      countryCode,
    );
    citizenContext.setDefaultTimeout(15000);
    const page = await citizenContext.newPage();
    await page.goto('http://127.0.0.1:5192/login');
    await page.getByLabel('Email address', { exact: true }).fill('citizen@surakuma.test');
    await page.locator('input[name=password]').fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL('**/app');
    await page.goto('http://127.0.0.1:5192/app/requests/new');
    await page.locator('input[value=FoodWater]').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('select[name=crisisId]').selectOption(crisis.id);
    await page
      .locator('textarea[name=description]')
      .fill(`Acceptance household needs food in ${countryCode}`);
    await page.locator('input[name=quantity]').fill('1');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('input[name=locationText]').fill('Acceptance community centre');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('input[name=synthetic]').check();
    const submitted = page.waitForResponse(
      (r) => r.url().endsWith('/requests') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Submit request', exact: true }).click();
    const response = await submitted;
    expect(response.status()).toBe(201);
    const aid = await response.json();
    cases.push({ id: aid.id, country: countryCode });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      accessibility.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
    ).toEqual([]);
    await citizenContext.close();
    const staffContext = await browser.newContext({ ignoreHTTPSErrors: true });
    staffContext.setDefaultTimeout(15000);
    await staffContext.addInitScript(
      (c) => localStorage.setItem('surakuma.country', c),
      countryCode,
    );
    const staff = await staffContext.newPage();
    await staff.goto('http://127.0.0.1:5192/login');
    await staff.getByLabel('Email address', { exact: true }).fill(email);
    await staff.locator('input[name=password]').fill(password);
    await staff.getByRole('button', { name: 'Log in', exact: true }).click();
    await staff.waitForURL('**/staff');
    await staff.goto(`http://127.0.0.1:5192/staff/cases/${aid.id}`);
    for (const action of ['Begin review', 'Verify request', 'Approve case']) {
      await staff.getByLabel('Reason / case note').fill('Acceptance verification');
      const changed = staff.waitForResponse(
        (r) => r.url().includes(`/requests/${aid.id}/status`) && r.request().method() === 'PATCH',
      );
      await staff.getByRole('button', { name: action, exact: true }).click();
      expect((await changed).ok()).toBeTruthy();
    }
    await staff.reload();
    await expect(staff.locator('select[name=resourceId]')).toContainText(`${countryCode} food`);
    await staff.getByRole('button', { name: 'Approve reservation', exact: true }).click();
    await staff.getByRole('button', { name: 'Dispatch', exact: true }).click();
    await staff.getByRole('button', { name: 'Confirm delivery', exact: true }).click();
    await expect(staff.getByText('Assistance delivered', { exact: true }).first()).toBeVisible();
    const staffLogin = await (
      await request.post(api + '/auth/login', { data: { email, password } })
    ).json();
    const staffHeaders = { Authorization: `Bearer ${staffLogin.accessToken}` };
    for (const foreign of cases.filter((c) => c.country !== countryCode))
      expect(
        (await request.get(`${api}/requests/${foreign.id}`, { headers: staffHeaders })).status(),
      ).toBe(404);
    expect(
      (
        await request.get(`${api}/resources?countryCode=${countryCode}`, { headers: staffHeaders })
      ).ok(),
    ).toBeTruthy();
    await staffContext.close();
    // Pace independent users sharing one loopback IP within the production limiter.
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  for (const own of cases) {
    const signedIn = await (
      await request.post(api + '/auth/login', {
        data: { email: `scope-${own.country.toLowerCase()}@acceptance.test`, password },
      })
    ).json();
    for (const foreign of cases.filter((c) => c.country !== own.country))
      expect(
        (
          await request.get(`${api}/requests/${foreign.id}`, {
            headers: { Authorization: `Bearer ${signedIn.accessToken}` },
          })
        ).status(),
      ).toBe(404);
  }
  const adminContext = await browser.newContext({ ignoreHTTPSErrors: true });
  adminContext.setDefaultTimeout(15000);
  await adminContext.addInitScript(() => localStorage.setItem('surakuma.country', 'IN'));
  const admin = await adminContext.newPage();
  await admin.goto('http://127.0.0.1:5192/login');
  await admin.getByLabel('Email address', { exact: true }).fill('admin@surakuma.test');
  await admin.locator('input[name=password]').fill(password);
  await admin.getByRole('button', { name: 'Log in', exact: true }).click();
  await admin.waitForURL('**/admin');
  await admin.goto('http://127.0.0.1:5192/admin?section=organisations');
  await admin.getByLabel('Incident name', { exact: true }).fill('Interface-created coordination');
  await admin.getByRole('button', { name: 'Create incident', exact: true }).click();
  await expect(
    admin.getByRole('heading', { name: 'Interface-created coordination', exact: true }),
  ).toBeVisible();
  const indianLink = admin.locator('p').filter({ hasText: 'Acceptance IN' });
  await indianLink.getByRole('button', { name: 'Unlink', exact: true }).click();
  await expect(indianLink).toHaveCount(0);
  await admin.getByLabel('International incident', { exact: true }).selectOption(incident.id);
  await admin
    .getByLabel('National crisis', { exact: true })
    .selectOption({ label: 'Acceptance IN' });
  await admin.getByRole('button', { name: 'Link crisis', exact: true }).click();
  await expect(indianLink).toBeVisible();
  await adminContext.close();
  const linked = await (await request.get(api + '/incidents', { headers })).json();
  expect(linked.find((i: { id: string }) => i.id === incident.id).crises).toHaveLength(3);
});
