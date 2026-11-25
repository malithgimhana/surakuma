import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const preview = process.env.VOLUNTEER_QA_URL;
const password = process.env.VOLUNTEER_QA_PASSWORD ?? process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
const role = 'VolunteerCoordinator';
const api = '/api/v1';
const workspace = '/staff/volunteers?role=VolunteerCoordinator';
const view = (tab: string) => `${workspace}&view=${tab}`;

test.use({
  ...(preview && { baseURL: preview }),
  ...(process.env.VOLUNTEER_QA_BROWSER && { channel: process.env.VOLUNTEER_QA_BROWSER }),
  timezoneId: 'UTC',
});
test.skip(!password || (!preview && !process.env.SURAKUMA_ACCEPTANCE_PASSWORD), 'Requires a disposable, seeded Surakuma preview database.');

async function signIn(page: Page, email: string, path = '/login') {
  await page.goto(path);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

async function capture(page: Page, name: string) {
  const output = process.env.VOLUNTEER_QA_SCREENSHOTS;
  if (output) await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
}

test('runs the coordinator and volunteer workflow against the API', async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString().slice(-8);
  const volunteerEmail = `shift-${suffix}@surakuma.test`;
  const volunteerName = `Workspace Volunteer ${suffix}`;
  const skill = `Intake ${suffix}`;
  const taskTitle = `Warehouse intake ${suffix}`;
  const staffLogin = await request.post(api + '/auth/login', {
    data: { email: 'volunteers@surakuma.test', password },
  });
  expect(staffLogin.ok()).toBeTruthy();
  const staff = await staffLogin.json();
  const organisationId = staff.user.memberships.find(
    (m: { role: string }) => m.role === role,
  ).organisationId;
  const adminLogin = await request.post(api + '/auth/login', {
    data: { email: 'admin@surakuma.test', password },
  });
  expect(adminLogin.ok()).toBeTruthy();
  const admin = await adminLogin.json();
  const user = await request.post(api + '/admin/users', {
    headers: { Authorization: `Bearer ${admin.accessToken}` },
    data: {
      email: volunteerEmail,
      password,
      name: volunteerName,
      organisationId,
      countryCode: 'LK',
      role: 'Volunteer',
    },
  });
  expect(user.ok()).toBeTruthy();
  const registered = await user.json();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem('surakuma.country', 'NP');
    localStorage.setItem('surakuma.theme', 'dark');
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await signIn(page, 'volunteers@surakuma.test', '/staff?role=VolunteerCoordinator');
  await expect(page.getByRole('heading', { name: 'Volunteer Coordinator Overview' })).toBeVisible();
  await expect(page.locator('.workspace-top').getByText('Sri Lanka')).toBeVisible();
  await expect(
    page.locator('.workspace-top').getByRole('combobox', { name: 'Country' }),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Needs your attention' })).toBeVisible();
  for (const skillName of [
    'Distribution',
    'First Aid',
    'Logistics',
    'Search and Rescue',
    'Shelter Support',
  ]) {
    await expect(
      page.getByRole('progressbar', { name: `${skillName} availability` }),
    ).toBeVisible();
  }
  await capture(page, 'workspace-overview');

  await page.getByRole('link', { name: 'Volunteer Coordination', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Volunteer directory results' })).toBeVisible();
  await capture(page, 'workspace-directory');
  await page.getByRole('link', { name: 'Link existing volunteer' }).click();
  await page.getByLabel('Search registered users').fill(volunteerEmail);
  await page.getByLabel('Registered user', { exact: true }).selectOption(registered.id);
  await page.getByLabel('Availability schedule').fill('Monday to Friday, 09:00–17:00');
  await page.getByLabel('Find or add a skill').fill(skill);
  await page.getByRole('button', { name: `Add “${skill}”` }).click();
  await capture(page, 'workspace-manage');
  await page.getByRole('button', { name: 'Save volunteer profile' }).click();
  await expect(page.getByRole('status')).toHaveText('Volunteer profile saved.');
  await expect(page.getByText('Pending verification', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Verify volunteer' }).click();
  await expect(page.getByText('Volunteer verified.', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Volunteer directory', exact: true }).click();
  await page.getByLabel('Search volunteers').fill(volunteerName);
  await page.getByLabel('Verification status').selectOption('verified');
  const volunteerRow = page.getByRole('row').filter({ hasText: volunteerName });
  await volunteerRow.getByRole('link', { name: 'Assign task' }).click();
  await page.getByLabel('Search cases').fill('Kelaniya');
  const caseSelector = page.getByLabel('Case', { exact: true });
  await expect(
    caseSelector
      .locator('option')
      .filter({ hasText: /Kelaniya/ })
      .first(),
  ).toBeAttached();
  await caseSelector.selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Start date', { exact: true })).toHaveAttribute('type', 'date');
  await page
    .getByLabel('Due date', { exact: true })
    .fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  await page.getByRole('checkbox', { name: skill, exact: true }).check();
  await expect(page.getByRole('radio', { name: new RegExp(volunteerName) })).toBeChecked();
  await capture(page, 'workspace-assignment');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Task title').fill(taskTitle);
  await page
    .getByLabel('Instructions')
    .fill('Check in with the warehouse supervisor before handling stock.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Confirm assignment' }).click();
  await expect(page.getByText('Assignment created.', { exact: true })).toBeVisible();
  await expect(page.getByText('Assigned', { exact: true })).toBeVisible();
  const detailsUrl = page.url();

  const volunteerContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
  });
  const volunteer = await volunteerContext.newPage();
  try {
    await volunteer.addInitScript(() => localStorage.setItem('surakuma.country', 'NP'));
    await signIn(volunteer, volunteerEmail);
    await expect(
      volunteer.getByRole('heading', { name: 'My volunteer assignments' }),
    ).toBeVisible();
    await expect(volunteer.getByRole('combobox', { name: 'Country', exact: true })).toHaveCount(0);
    await expect(volunteer.getByRole('button', { name: 'In progress (0)' })).toBeVisible();
    const openTask = () =>
      volunteer.getByRole('button', { name: `View details for ${taskTitle}` }).click();
    const task = volunteer.getByRole('dialog', { name: taskTitle });
    await capture(volunteer, 'volunteer-self-assignments');
    await openTask();
    await expect(task.getByText(/Check in with the warehouse supervisor/)).toBeVisible();
    await task.getByRole('button', { name: 'Accept', exact: true }).click();
    await task.getByRole('button', { name: 'Start assignment', exact: true }).click();
    await task
      .getByLabel('Progress update')
      .fill('Checked in with the supervisor and reviewed the intake area.');
    await task.getByRole('button', { name: 'Post progress update' }).click();
    await page.goto(detailsUrl);
    await expect(page.getByText(/Checked in with the supervisor and reviewed/)).toBeVisible();
    await capture(page, 'workspace-deployment-details');
    await page.getByRole('link', { name: 'Active Deployments', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Deployment tracker results' })).toBeVisible();
    await capture(page, 'workspace-deployments');
    await task
      .getByLabel('Work completed')
      .fill('Reviewed intake and prepared the receiving area.');
    await task.getByLabel('Actual outcome').fill('Receiving area cleared for incoming deliveries.');
    await task.getByRole('button', { name: 'Submit for verification' }).click();
    await expect(task.getByText(/^Awaiting verification$/i)).toBeVisible();
    await expect(task.getByRole('button', { name: 'Verify report' })).toHaveCount(0);
    await task.getByRole('button', { name: 'Close dialog' }).click();
    await expect(volunteer.getByRole('button', { name: 'In progress (0)' })).toBeVisible();
    await volunteer.getByRole('button', { name: 'Awaiting verification (1)' }).click();
    await expect(
      volunteer.getByRole('button', { name: `View details for ${taskTitle}` }),
    ).toBeVisible();
    await page.goto(view('reports'));
    await page.getByRole('link', { name: new RegExp(taskTitle) }).click();
    const submittedReport = page
      .locator('.vc-inset')
      .filter({ has: page.getByRole('heading', { name: 'Submitted report', exact: true }) });
    await expect(
      submittedReport.getByText('Receiving area cleared for incoming deliveries.'),
    ).toBeVisible();
    await capture(page, 'workspace-verification');
    await page.getByLabel('Verification notes').fill('Confirm who inspected the receiving area.');
    await page.getByRole('button', { name: 'Return for correction' }).click();
    await expect(page.getByText('Report returned for correction.', { exact: true })).toBeVisible();

    await volunteer.reload();
    await openTask();
    await task
      .getByLabel('Work completed')
      .fill('The volunteer and warehouse supervisor inspected the area.');
    await task
      .getByLabel('Actual outcome')
      .fill('Receiving area confirmed ready for incoming deliveries.');
    await task.getByRole('button', { name: 'Submit for verification' }).click();
    await expect(task.getByText(/^Awaiting verification$/i)).toBeVisible();
    await page.reload();
    await expect(
      submittedReport.getByText('Receiving area confirmed ready for incoming deliveries.'),
    ).toBeVisible();
    await page
      .getByLabel('Verification notes')
      .fill('Confirmed the inspection and the recorded outcome.');
    await page.getByRole('button', { name: 'Verify report' }).click();
    await expect(page.getByText('Report verified.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify report', exact: true })).toHaveCount(0);
    await volunteer.reload();
    await volunteer.getByRole('button', { name: 'Completed (1)' }).click();
    await expect(volunteer.getByRole('heading', { name: taskTitle })).toBeVisible();
    await volunteer.getByRole('link', { name: 'My profile', exact: true }).click();
    await expect(volunteer.getByRole('heading', { name: volunteerName })).toBeVisible();
    await expect(volunteer.getByText('Verified', { exact: true }).first()).toBeVisible();
    await capture(volunteer, 'volunteer-self-profile');
    await volunteer.getByRole('link', { name: 'Edit profile' }).click();
    await expect(volunteer.getByLabel('Email address')).toHaveAttribute('readonly', '');
    await capture(volunteer, 'volunteer-self-edit');
    await volunteer.getByLabel('Work phone (optional)').fill('invalid');
    await volunteer.getByRole('button', { name: 'Save changes' }).click();
    await expect(volunteer.getByRole('alert')).toContainText('Enter a phone number');
    await volunteer.getByRole('button', { name: 'Cancel' }).click();
    await volunteer.getByRole('button', { name: 'Discard changes' }).click();
    await expect(volunteer.getByRole('heading', { name: 'My profile' })).toBeVisible();
    await volunteer.getByRole('link', { name: 'Edit profile' }).click();
    await expect(volunteer.getByLabel('Work phone (optional)')).toHaveValue('');
    await volunteer.getByLabel('Recorded skills').fill('Logistics');
    await volunteer.getByRole('button', { name: 'Add', exact: true }).click();
    await volunteer.getByLabel('Availability schedule').fill('Weekends');
    const regionSelect = volunteer.getByLabel('Administrative region');
    await expect(regionSelect.locator('option').nth(1)).toBeAttached();
    const regionOption = regionSelect.locator('option').nth(1);
    const regionName = (await regionOption.textContent())!.split(' · ')[0];
    await regionSelect.selectOption((await regionOption.getAttribute('value'))!);
    await volunteer.getByLabel('Use my service point to rank nearby assignments').check();
    await volunteer.getByLabel('Service point latitude').fill('6.9');
    await volunteer.getByLabel('Service point longitude').fill('79.8');
    await volunteer.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      volunteer.getByRole('status').filter({ hasText: 'Profile changes saved.' }),
    ).toBeVisible();
    await volunteer.reload();
    await expect(volunteer.getByText('Logistics', { exact: true })).toBeVisible();
    await expect(volunteer.getByText('Weekends', { exact: true })).toBeVisible();
    await expect(volunteer.getByText(regionName, { exact: true })).toBeVisible();
    await expect(volunteer.getByText('6.90000, 79.80000')).toBeVisible();
    await volunteer.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => volunteer.evaluate(() => document.documentElement.scrollWidth))
      .toBe(390);
    await capture(volunteer, 'volunteer-self-profile-mobile');
    await volunteer.getByRole('link', { name: 'Edit profile' }).click();
    await expect
      .poll(() => volunteer.evaluate(() => document.documentElement.scrollWidth))
      .toBe(390);
    await capture(volunteer, 'volunteer-self-edit-mobile');
    await volunteer.goto('/volunteer');
    await expect(volunteer.getByRole('button', { name: 'Completed (1)' })).toBeVisible();
    await expect
      .poll(() => volunteer.evaluate(() => document.documentElement.scrollWidth))
      .toBe(390);
    await capture(volunteer, 'volunteer-self-assignments-mobile');
    const volunteerAccessibility = await new AxeBuilder({ page: volunteer })
      .include('.volunteer-self-page')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(volunteerAccessibility.violations).toEqual([]);
  } finally {
    await volunteerContext.close();
  }

  await page.getByRole('link', { name: 'My Profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Role and organisation' })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: false })).toHaveAttribute('readonly', '');
  await page.getByLabel('Full name').fill('Workspace Coordinator');
  await page.getByLabel('Work phone').fill('+94 77 555 0100');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace Coordinator' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Work phone')).toHaveValue('+94 77 555 0100');
  await capture(page, 'workspace-profile');

  await page.setViewportSize({ width: 830, height: 1000 });
  await page.goto(view('directory'));
  await expect(page.getByRole('table', { name: 'Volunteer directory results' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(830);
  await capture(page, 'workspace-tablet');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(view('directory'));
  await expect(page.getByRole('table', { name: 'Volunteer directory results' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(
    page.getByRole('link', { name: 'Volunteer Directory', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Active Deployments', exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole('link', { name: 'Volunteer Directory', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await capture(page, 'workspace-mobile');
  const accessibility = await new AxeBuilder({ page })
    .include('.vc-page')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(pageErrors).toEqual([]);
});
