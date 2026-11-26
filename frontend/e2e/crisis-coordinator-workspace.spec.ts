import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pathToFileURL } from 'node:url';

const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
const api = '/api/v1';
const scope = 'countryCode=LK&staffRole=Coordinator';
const output = process.env.COORDINATOR_QA_SCREENSHOTS;
const isolated = /^Server=\(localdb\)\\\w+;Database=Surakuma_(?:Assessment_)?Acceptance_[a-f0-9]{32};/i
  .test(process.env.ConnectionStrings__Default ?? '') && process.env.Email__Provider === 'Capture';

test.skip(!password || !isolated, 'Use the isolated LocalDB acceptance harness with capture-only delivery.');

async function headers(request: APIRequestContext, account: string) {
  const response = await request.post(api + '/auth/login', { data: { email: `${account}@surakuma.test`, password } });
  await expect(response).toBeOK();
  return { Authorization: `Bearer ${(await response.json()).accessToken}` };
}

async function screenshot(page: Page, name: string) {
  if (output) await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
}

test('Crisis Coordinator workspace connects all seven pages to the controlled backend', async ({ page, browser, request }) => {
  const coordinator = await headers(request, 'coordinator');
  const manager = await headers(request, 'case');
  const admin = await headers(request, 'admin');
  const volunteer = await headers(request, 'volunteer');
  const roster = await request.get(`${api}/volunteers?${scope}`, { headers: coordinator });
  await expect(roster).toBeOK();
  const assignment = (await roster.json()).tasks.find((task: { title: string }) =>
    task.title === 'Prepare household food pack delivery');
  expect(assignment).toBeTruthy();
  const report = 'Prepared the assigned meal packs for the test delivery.';
  for (const action of ['Accept', 'Start', 'Complete']) {
    await expect(await request.post(`${api}/volunteer-tasks/${assignment.id}?countryCode=LK`, {
      headers: volunteer, data: { action, workDescription: report, outcome: 'Packs were ready for the exercise.', peopleAssisted: 4 },
    })).toBeOK();
  }
  expect((await request.post(`${api}/volunteer-tasks/${assignment.id}?${scope}`, {
    headers: coordinator, data: { action: 'Verify', note: 'Verify test scoped permissions.' },
  })).status()).toBe(403);
  const critical = await request.get(`${api}/requests?${scope}&view=critical`, { headers: coordinator });
  await expect(critical).toBeOK();
  const medical = (await critical.json()).items.find((row: { category: string }) => row.category === 'Medical');
  expect(medical).toBeTruthy();
  const medicalPath = `${api}/requests/${medical.id}`;
  for (const status of ['UnderReview', 'Verified', 'Approved']) {
    await expect(await request.patch(medicalPath + '/status?countryCode=LK', {
      headers: manager, data: { status, reason: 'Isolated acceptance case decision.' },
    })).toBeOK();
  }
  await expect(await request.post(medicalPath + '/recommendations/generate?countryCode=LK', { headers: manager })).toBeOK();
  const citizen = await headers(request, 'citizen');
  const shortageSubmission = await request.post(`${api}/requests`, { headers: citizen, data: {
    crisisId: medical.crisisId, category: 'FoodWater', priority: 'Normal', description: 'Synthetic food shortage for the coordinator exercise.',
    locationText: 'Synthetic Colombo collection point', quantity: 1000, unit: 'packs', householdSize: 4, accessibilityNeeds: '',
    submissionKey: crypto.randomUUID(), synthetic: true,
  } });
  expect(shortageSubmission.status()).toBe(201);
  const shortage = await shortageSubmission.json();
  for (const status of ['UnderReview', 'Verified', 'Approved']) {
    await expect(await request.patch(`${api}/requests/${shortage.id}/status?countryCode=LK`, {
      headers: manager, data: { status, reason: 'Verified synthetic demand exceeds the stock on hand.' },
    })).toBeOK();
  }
  expect((await request.patch(medicalPath + `/status?${scope}`, {
    headers: coordinator, data: { status: 'Rejected', reason: 'Test of scoped permissions.' },
  })).status()).toBe(403);
  expect((await request.get(`${api}/staff/coordinator/inventory?countryCode=NP&staffRole=Coordinator`, {
    headers: coordinator,
  })).status()).toBe(403);

  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login');
  await page.getByLabel('Email address').fill('coordinator@surakuma.test');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  await expect(page.getByRole('heading', { name: 'Crisis command centre' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Coordination priorities' }).getByRole('link')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'Priority action queue' })).toBeVisible();
  await screenshot(page, '01-overview');

  await nav.getByRole('link', { name: 'Cases & AI Review' }).click();
  await expect(page.getByRole('heading', { name: 'Cases & AI Review' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Case views' }).getByRole('link', { name: 'Critical' }).click();
  await expect(page.getByRole('link', { name: medical.reference, exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: medical.reference }).getByText('Ready', { exact: true })).toBeVisible();
  await screenshot(page, '02-cases');
  await page.getByRole('link', { name: medical.reference, exact: true }).click();
  await expect(page.getByRole('heading', { name: medical.reference, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI decision support' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Decision timeline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve case', exact: true })).toHaveCount(0);
  await screenshot(page, '03-case-detail');
  await expect(page.getByRole('link', { name: /Check stock/ })).toBeVisible();

  await nav.getByRole('link', { name: 'Overview' }).click();
  await page.getByRole('link', { name: /Cases with stock shortages/ }).click();
  const shortages = page.getByRole('region', { name: 'Case results' });
  await shortages.getByRole('link', { name: shortage.reference, exact: true }).click();
  await expect(page.getByText(/Suitable stock is insufficient/)).toBeVisible();
  await page.getByRole('link', { name: /Check stock/ }).click();
  await expect(page.getByRole('heading', { name: 'Resource availability' })).toBeVisible();
  const stock = page.getByRole('button', { name: 'Family food packs', exact: true });
  await expect(stock).toBeVisible();
  await screenshot(page, '04-resources');
  await stock.click();
  await expect(page.getByRole('dialog', { name: 'Family food packs' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(stock).toBeFocused();

  await nav.getByRole('link', { name: 'Shelter capacity' }).click();
  await expect(page.getByRole('heading', { name: 'Shelter capacity' })).toBeVisible();
  await expect(page.getByText('Riverside Community Centre', { exact: true })).toBeVisible();
  await screenshot(page, '05-shelters');
  await page.getByRole('button', { name: /View.*Riverside Community Centre/ }).click();
  await expect(page.getByRole('dialog', { name: 'Riverside Community Centre' })).toBeVisible();
  await page.keyboard.press('Escape');

  await nav.getByRole('link', { name: 'Volunteer progress' }).click();
  const task = page.getByRole('button', { name: 'Prepare household food pack delivery' });
  await expect(task).toBeVisible();
  await screenshot(page, '06-volunteers');
  await task.click();
  await expect(page.getByRole('heading', { name: 'Reporting history' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Field reports' }).click();
  await expect(page.getByRole('heading', { name: 'Field reports', exact: true })).toBeVisible();
  await expect(page.getByText(report, { exact: true })).toBeVisible();
  await screenshot(page, '06b-volunteer-field-reports');
  await page.getByRole('link', { name: 'Progress summary' }).click();
  await expect(page.getByRole('heading', { name: 'Progress summary' })).toBeVisible();

  await nav.getByRole('link', { name: 'Crises & public alerts' }).click();
  await expect(page.getByRole('heading', { name: 'Kelani River flood response' })).toBeVisible();
  await screenshot(page, '07-crises');
  await page.getByRole('link', { name: 'Create Crisis' }).click();
  const crisis = 'Isolated coordinator exercise ' + Date.now();
  await page.getByLabel('Crisis name').fill(crisis);
  await page.getByLabel('Local area').fill('Colombo');
  await page.getByLabel('Latitude').fill('6.93');
  await page.getByLabel('Longitude').fill('79.89');
  await screenshot(page, '08-create-crisis');
  await page.getByRole('button', { name: 'Create response event' }).click();
  const response = page.locator('.coord-response-event').filter({ has: page.getByRole('heading', { name: crisis, exact: true }) });
  await expect(response).toBeVisible();
  await response.getByRole('button', { name: 'End response', exact: true }).click();
  await page.getByRole('dialog', { name: 'End response event?' }).getByRole('button', { name: 'End response', exact: true }).click();
  await response.getByRole('button', { name: 'Reopen response', exact: true }).click();
  await page.getByRole('dialog', { name: 'Reopen response event?' }).getByRole('button', { name: 'Reopen response', exact: true }).click();
  await response.getByRole('button', { name: 'Operational areas' }).click();
  const areas = page.getByRole('dialog', { name: 'Operational areas' });
  await areas.getByLabel('Area name').fill('Exercise area');
  await areas.getByLabel('GeoJSON Polygon or MultiPolygon').fill('{"type":"Polygon","coordinates":[[[79.85,6.90],[79.95,6.90],[79.95,6.99],[79.85,6.90]]]}');
  await areas.getByRole('button', { name: 'Add operational area' }).click();
  await expect(areas.getByText('Exercise area', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await response.getByRole('button', { name: 'Compose alert' }).click();
  const title = 'Controlled coordinator alert';
  await page.getByLabel('Severity').selectOption('Critical');
  await page.getByLabel('Affected area').fill('Exercise area');
  await page.getByLabel('Issuing authority').fill('Isolated acceptance exercise');
  await page.getByLabel('Expires at').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  const editor = page.getByRole('group', { name: 'Alert language', exact: true });
  for (const [language, heading, wording] of [
    ['English', title, 'This is a controlled exercise.'],
    ['Sinhala', 'පරීක්ෂණ නිවේදනය', 'මෙය පරීක්ෂණයකි.'],
    ['Tamil', 'சோதனை அறிவிப்பு', 'இது ஒரு சோதனை.'],
  ]) {
    await editor.getByRole('button', { name: new RegExp(language === 'Sinhala' ? 'Sinhala|Sinhalese' : language) }).click();
    await page.locator('.crisis-composer-form input[lang]').fill(heading);
    await page.locator('.crisis-composer-form textarea[lang]').fill(wording);
  }
  await editor.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('complementary', { name: 'Public alert preview' }).getByText(title)).toBeVisible();
  await screenshot(page, '09-alert-composer');
  await page.getByRole('button', { name: 'Preview alert draft' }).click();
  const preview = page.getByRole('dialog', { name: 'Preview public alert' });
  await preview.getByRole('checkbox', { name: /reviewed the public wording/ }).check();
  await preview.getByRole('button', { name: /Save draft/ }).click();

  const selectAlert = () => page.getByRole('button', { name: `View alert: ${title}` }).click();
  await selectAlert();
  const alertDetail = page.getByRole('dialog', { name: title });
  await alertDetail.getByRole('button', { name: 'Submit for review' }).click();
  await expect(alertDetail).toBeHidden();
  const pending = await request.get(`${api}/admin/crisis-operations/alerts?countryCode=LK&status=PendingReview&search=${encodeURIComponent(title)}`, {
    headers: admin,
  });
  await expect(pending).toBeOK();
  const alert = (await pending.json()).items[0].alert;
  await expect(await request.post(`${api}/alerts/${alert.id}/approve?countryCode=LK`, {
    headers: admin, data: { reason: 'Verified all three translations for the isolated exercise.' },
  })).toBeOK();
  await page.getByLabel('Filter by status').selectOption('Approved');
  await selectAlert();
  await alertDetail.getByRole('button', { name: 'Publish alert', exact: true }).click();
  await expect(alertDetail.getByRole('button', { name: 'Confirm publication' })).toBeDisabled();
  await alertDetail.getByRole('checkbox', { name: /verified the .* wording/ }).check();
  await alertDetail.getByRole('button', { name: 'Confirm publication' }).click();
  await expect(alertDetail).toBeHidden();
  const publicAlerts = await request.get(`${api}/alerts?countryCode=LK`);
  await expect(publicAlerts).toBeOK();
  expect((await publicAlerts.json()).some((item: { id: string }) => item.id === alert.id)).toBe(true);
  const notifications = await request.get(`${api}/notifications?${scope}`, { headers: coordinator });
  await expect(notifications).toBeOK();
  const inbox = (await notifications.json()).map((item: { message: string }) => item.message);
  expect(inbox).toContain(`Public alerts · ${crisis}: Your alert was approved for publication.`);
  expect(inbox.some((message: string) => message.includes('public alert was published'))).toBe(false);
  await page.getByLabel('Filter by status').selectOption('Published');
  await expect(page.getByRole('button', { name: `View alert: ${title}` })).toBeVisible();
  await screenshot(page, '10-published-alerts');
  await selectAlert();
  await expect(alertDetail.getByText('இது ஒரு சோதனை.')).toBeVisible();
  await alertDetail.getByText('Review and publication history').click();
  await expect(alertDetail.getByText(/Published ·/)).toBeVisible();
  await screenshot(page, '11-alert-detail');
  await page.keyboard.press('Escape');

  await nav.getByRole('link', { name: 'My profile' }).click();
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
  await page.getByLabel('Full name').fill('Nimali Perera QA');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Nimali Perera QA' })).toBeVisible();
  await expect(page.getByRole('link', { name: crisis })).toBeVisible();
  await screenshot(page, '12-profile');

  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  await menu.click();
  await expect(nav).toBeVisible();
  await screenshot(page, '13a-mobile-menu');
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await menu.click();
  await nav.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByRole('heading', { name: 'Crisis command centre' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Priority action queue' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await screenshot(page, '13-overview-mobile');
  expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  for (const [link, heading] of [
    ['Cases & AI Review', 'Cases & AI Review'],
    ['Resource availability', 'Resource availability'],
    ['Shelter capacity', 'Shelter capacity'],
    ['Volunteer progress', 'Volunteer progress'],
    ['Crises & public alerts', 'Crises & public alerts'],
    ['My profile', 'My Profile'],
  ]) {
    await menu.click();
    await nav.getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.locator('main .loading')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), heading).toBeLessThanOrEqual(390);
  }
  await page.setViewportSize({ width: 768, height: 1024 });
  await menu.click();
  await nav.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByRole('heading', { name: 'Priority action queue' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
  await screenshot(page, '14-overview-tablet');
  expect(pageErrors).toEqual([]);

  const reference = process.env.COORDINATOR_REFERENCE_HTML;
  if (reference && output) {
    const mock = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await mock.goto(pathToFileURL(reference).href, { waitUntil: 'domcontentloaded' });
    for (const name of ['overview', 'cases', 'resources', 'shelters', 'volunteers', 'crises', 'profile']) {
      await mock.locator(`[data-page="${name}"]`).click();
      await screenshot(mock, 'reference-' + name);
    }
    await mock.close();
  }
});
