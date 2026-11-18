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
    expect((await request.post(`${api}/admin/organisations/${organisationId}/countries/${countryCode}/verification`, { headers, data: { evidence: 'Synthetic partner registration checked', decision: 'Verified', reason: 'Acceptance verification' } })).ok()).toBeTruthy();
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
    await expect(staff.getByRole('heading', { name: 'Crisis Coordinator overview' })).toBeVisible();
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
    const receipt = staff.getByRole('dialog', { name: 'Confirm delivery' });
    await receipt.getByLabel('Delivery reference').fill(`ACCEPTANCE-${countryCode}`);
    await receipt.getByLabel('Receiving person or representative').fill('Synthetic receiving representative');
    await receipt.getByRole('button', { name: 'Record receipt' }).click();
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
  const admin = await adminContext.newPage();
  await admin.goto('http://127.0.0.1:5192/login');
  await admin.getByLabel('Email address', { exact: true }).fill('admin@surakuma.test');
  await admin.locator('input[name=password]').fill(password);
  await admin.getByRole('button', { name: 'Log in', exact: true }).click();
  await admin.waitForURL('**/admin');
  await expect(admin.getByRole('heading', { name: 'System Administration' })).toBeVisible();
  await expect(admin.getByRole('combobox', { name: 'Country', exact: true })).toHaveValue('LK');
  const overviewCountry = admin.getByRole('combobox', { name: 'Country', exact: true });
  const overviewMetrics = admin.getByRole('list', { name: 'Response figures' }).locator('strong');
  const distribution = admin.getByRole('region', { name: /Crisis distribution/ });
  const overviewTable = admin.getByRole('table', { name: 'Country operations overview' });
  for (const code of ['LK', 'NP', 'IN']) {
    await overviewCountry.selectOption(code);
    const report = await (await request.get(`${api}/admin/reports?scope=country&countryCode=${code}`, { headers })).json();
    await expect(overviewMetrics).toHaveText(['activeCrises', 'open', 'unassigned', 'overdue', 'resolved'].map(key => String(report.totals[key])));
    await expect(distribution.getByRole('link', { name: new RegExp(`Acceptance ${code}`) })).toBeVisible();
    for (const other of ['LK', 'NP', 'IN'].filter(country => country !== code))
      await expect(distribution.getByRole('link', { name: new RegExp(`Acceptance ${other}`) })).toHaveCount(0);
    await expect(overviewTable.getByRole('row')).toHaveCount(4);
  }
  await overviewCountry.selectOption('LK');
  await expect(distribution.getByRole('link', { name: /Acceptance LK/ })).toBeVisible();
  await expect(admin.locator('.overview-crisis-map .leaflet-interactive').first()).toBeVisible();
  await expect(admin.getByText(/Last updated/)).toBeVisible();
  await admin.screenshot({ path: test.info().outputPath('administration-overview.png'), fullPage: true });
  await admin.goto('http://127.0.0.1:5192/admin?section=reports');
  await expect(admin.getByRole('heading', { name: 'Operational reports' })).toBeVisible();
  await admin.screenshot({ path: test.info().outputPath('administration-reports.png'), fullPage: true });
  const download = admin.waitForEvent('download'); await admin.getByRole('button', { name: 'Download CSV' }).click(); expect((await download).suggestedFilename()).toContain('.csv');
  const pdf = admin.waitForEvent('download');
  await admin.getByRole('button', { name: 'Export PDF' }).click();
  expect((await pdf).suggestedFilename()).toBe('surakuma-operational-report.pdf');
  await admin.getByLabel('Report scope').selectOption('all');
  for (const country of ['Sri Lanka', 'Nepal', 'India']) {
    await expect(admin.getByRole('rowheader', { name: country, exact: true }).first()).toBeVisible();
  }
  await admin.goto('http://127.0.0.1:5192/admin?section=users');
  await expect(admin.getByRole('heading', { name: 'System Administrator access requests' })).toBeVisible();
  await expect(admin.getByRole('link', { name: 'Approvals', exact: true })).toHaveCount(0);
  await admin.goto('http://127.0.0.1:5192/admin?section=alerts'); await expect(admin.getByRole('heading', { name: 'Administrator alerts' })).toBeVisible();
  await admin.setViewportSize({ width: 390, height: 844 });
  expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const adminAxe = await new AxeBuilder({ page: admin }).withTags(['wcag2a', 'wcag2aa']).analyze(); expect(adminAxe.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  await admin.setViewportSize({ width: 1280, height: 900 });
  await admin.goto('http://127.0.0.1:5192/admin/crises');
  await expect(admin.getByRole('heading', { name: 'Acceptance LK', exact: true })).toBeVisible();
  await expect(admin.getByRole('heading', { name: 'Acceptance IN', exact: true })).toHaveCount(0);
  await admin.getByLabel('Country', { exact: true }).selectOption('IN');
  await expect(admin.getByRole('heading', { name: 'Acceptance IN', exact: true })).toBeVisible();
  await expect(admin.getByRole('heading', { name: 'Acceptance LK', exact: true })).toHaveCount(0);
  await adminContext.close();
});


test('volunteer reports, partner assignments and independent alert review work in their own workspaces', async ({ browser, request }) => {
  const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
  if (!password) throw new Error('Run only through the isolated acceptance script.');
  const api = 'https://localhost:7143/api/v1';
  const origin = 'http://127.0.0.1:5192';
  const admin = await request.post(api + '/auth/login', { data: { email: 'admin@surakuma.test', password } });
  expect(admin.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await admin.json()).accessToken}` };
  const pageOfCases = await (await request.get(api + '/requests?countryCode=LK&status=Approved', { headers })).json();
  const food = pageOfCases.items.find((row: { category: string }) => row.category === 'FoodWater');
  expect(food).toBeTruthy();

  async function signIn(email: string, path: string) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(origin + '/login');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.locator('input[name=password]').fill(password!);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL(origin + path);
    return { context, page };
  }

  const volunteer = await signIn('volunteer@surakuma.test', '/volunteer');
  await volunteer.page.getByRole('button', { name: 'Accept', exact: true }).click();
  await volunteer.page.getByRole('button', { name: 'Start', exact: true }).click();
  await volunteer.page.getByLabel('Work completed', { exact: true }).fill('Prepared the collection point and distributed family food packs.');
  await volunteer.page.getByLabel('Actual outcome', { exact: true }).fill('Four households collected their packs during the shift.');
  await volunteer.page.getByLabel('People assisted (if applicable)', { exact: true }).fill('4');
  await volunteer.page.getByRole('button', { name: 'Submit for verification' }).click();
  await expect(volunteer.page.getByText(/^Awaiting verification$/i)).toBeVisible();
  await volunteer.context.close();
  const coordinator = await signIn('volunteers@surakuma.test', '/staff');
  await coordinator.page.getByRole('link', { name: 'Reports awaiting verification', exact: true }).click();
  await expect(coordinator.page.getByText(/Four households collected their packs/)).toBeVisible();
  await coordinator.page.getByLabel('Verification notes').fill('Checked the report against the assignment and shift record.');
  await coordinator.page.getByRole('button', { name: 'Verify report' }).click();
  await expect(coordinator.page.getByText('No tasks match this queue')).toBeVisible();
  await coordinator.context.close();

  const partnerEmail = 'phase-partner@acceptance.test';
  expect((await request.post(api + '/admin/users', { headers, data: {
    email: partnerEmail, password, name: 'Acceptance partner', role: 'Partner', organisationId: food.organisationId, countryCode: 'LK',
  } })).ok()).toBeTruthy();
  expect((await request.put(`${api}/partner/cases/${food.id}/shares/${food.organisationId}?countryCode=LK`, { headers, data: {
    title: 'Coordinate collection', instructions: 'Confirm the collection window with the response team.',
  } })).ok()).toBeTruthy();
  const partner = await signIn(partnerEmail, '/partner');
  await partner.page.getByRole('main').getByRole('link', { name: 'Assigned work', exact: true }).click();
  await expect(partner.page.getByRole('heading', { name: 'Coordinate collection' })).toBeVisible();
  await expect(partner.page.getByText('Confirm the collection window with the response team.')).toBeVisible();
  expect(await partner.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const partnerAxe = await new AxeBuilder({ page: partner.page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(partnerAxe.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([]);
  await partner.page.goto(origin + '/partner/notifications');
  await expect(partner.page.getByText(/New partner assignment/)).toBeVisible();
  await partner.context.close();

  const reviewerEmail = 'phase-reviewer@acceptance.test';
  expect((await request.post(api + '/admin/users', { headers, data: {
    email: reviewerEmail, password, name: 'Alert reviewer', role: 'CountryAdministrator', countryCode: 'LK',
  } })).ok()).toBeTruthy();
  const draft = await request.post(api + '/alerts?countryCode=LK', { headers, data: {
    crisisId: food.crisisId, title: 'Synthetic cleanup notice', message: 'Follow the instructions of the response team.',
    sinhalaTitle: 'පරීක්ෂණ නිවේදනය', sinhalaMessage: 'පරීක්ෂණ පණිවිඩය',
    tamilTitle: 'சோதனை அறிவிப்பு', tamilMessage: 'சோதனைச் செய்தி',
    area: 'Test area', authority: 'Isolated acceptance team', severity: 'Information',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  } });
  expect(draft.ok()).toBeTruthy();
  const { id } = await draft.json();
  expect((await request.post(`${api}/alerts/${id}/submit?countryCode=LK`, { headers })).ok()).toBeTruthy();
  const reviewer = await signIn(reviewerEmail, '/admin');
  await reviewer.page.goto(origin + '/admin/crises');
  await reviewer.page.getByRole('button', { name: 'Review queue' }).click();
  await reviewer.page.getByRole('button', { name: 'View alert: Synthetic cleanup notice' }).click();
  const review = reviewer.page.getByRole('dialog', { name: 'Synthetic cleanup notice' });
  await review.getByRole('button', { name: 'Approve alert' }).click();
  await review.getByLabel('Reason', { exact: true }).fill('Checked the duty team, area and translated wording.');
  await review.getByRole('button', { name: 'Approve alert' }).click();
  await expect(review).toHaveCount(0);
  expect((await request.post(`${api}/alerts/${id}/publish?countryCode=LK`, { headers })).ok()).toBeTruthy();
  const feed = await (await request.get(api + '/alerts?countryCode=LK')).json();
  expect(feed.some((alert: { id: string }) => alert.id === id)).toBeTruthy();
  await reviewer.context.close();
});

test('country administrator sees only authorised reporting and cannot verify partners', async ({ browser, request }) => {
  const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
  if (!password) throw new Error('Run only through the isolated acceptance script.');
  const api = 'https://localhost:7143/api/v1';
  const login = await request.post(api + '/auth/login', { data: { email: 'admin@surakuma.test', password } });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const lookup = await (await request.get(api + '/public/lookups?countryCode=LK')).json();
  const organisationId = lookup.organisations[0].id;
  expect((await request.post(api + '/admin/users', { headers, data: { name: 'Country administrator', email: 'national@acceptance.test', password, role: 'CountryAdministrator', countryCode: 'LK' } })).ok()).toBeTruthy();
  expect((await request.put(`${api}/admin/organisations/${organisationId}/countries/NP`, { headers })).ok()).toBeTruthy();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => localStorage.setItem('surakuma.country', 'NP'));
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5192/login');
  await page.getByLabel('Email address', { exact: true }).fill('national@acceptance.test');
  await page.locator('input[name=password]').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('**/admin');
  await expect(page.locator('.sidebar-caption')).toHaveText('COUNTRY ADMINISTRATION');
  await expect(page.getByRole('combobox', { name: 'Country', exact: true })).toHaveCount(0);
  await expect(page.locator('.workspace-country')).toHaveText('Country Sri Lanka');
  await expect(page.getByRole('list', { name: 'Response figures' })).toBeVisible();
  const overview = page.getByRole('table', { name: 'Country operations overview' });
  await expect(overview.getByRole('rowheader')).toHaveCount(1);
  await expect(overview.getByRole('rowheader')).toContainText('Sri Lanka');
  await page.goto('http://127.0.0.1:5192/admin?section=users');
  await expect(page.getByRole('row', { name: /national@acceptance\.test/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /citizen@surakuma\.test/ })).toContainText('View only');
  await page.goto('http://127.0.0.1:5192/admin?section=organisations');
  const review = page.getByRole('button', { name: /^(View|Review) verification$/ });
  await review.click();
  await expect(page.getByRole('button', { name: 'Save evidence' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify partner' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('country-partner-review-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Back to partner' }).click();
  await page.getByRole('button', { name: 'Remove from Sri Lanka' }).click();
  const removal = page.getByRole('dialog', { name: 'Remove from Sri Lanka?' });
  await expect(removal.getByText(/directory.*open cases/)).toBeVisible();
  await removal.getByRole('button', { name: 'Remove from Sri Lanka' }).click();
  await expect(page.getByRole('status')).toContainText('was removed from Sri Lanka.');
  const remaining = await (await request.get(api + '/admin/organisations?countryCode=NP', { headers })).json();
  expect(remaining.some((organisation: { id: string }) => organisation.id === organisationId)).toBeTruthy();
  await context.close();
});
