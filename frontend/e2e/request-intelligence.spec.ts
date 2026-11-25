import { expect, test } from '@playwright/test';

test('a medical request keeps its Critical priority when automated assessment is unavailable', async ({ page }, run) => {
  const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
  test.skip(!password || !!process.env.SURAKUMA_ACCEPTANCE_AI_PROVIDER, 'Requires the isolated rules-only rehearsal.');
  async function login(account: string) {
    await page.getByLabel('Email address', { exact: true }).fill(account + '@surakuma.test');
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
  }
  await page.goto('/');
  await page.getByRole('link', { name: /^Medical help / }).click();
  await login('citizen');
  await expect(page.getByRole('radio', { name: /Medical help/ })).toBeChecked();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Crisis event').selectOption({ label: 'Kelani River flood response' });
  await page.getByLabel('What medical help is needed?').selectOption('MedicalCare');
  await page.getByLabel('When do you need medical help?').selectOption('Now');
  await page.getByRole('radio', { name: 'Yes', exact: true }).check();
  await expect(page.getByRole('link', { name: /View emergency contacts/ })).toHaveAttribute('href', '/contact');
  await page.getByLabel('Describe what you need').fill('Synthetic emergency request to verify the priority seen by staff.');
  await page.screenshot({ path: run.outputPath('immediate-danger-intake.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Location', { exact: true }).fill('Synthetic community centre');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your request has been received' })).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').pop();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.waitForURL('/');
  await page.goto('/login');
  await login('case');
  await page.waitForURL('/staff');
  await page.goto(`/staff/cases/${id}`);
  const assessment = page.locator('.citizen-triage-card');
  await expect(assessment.getByText('AI assessment unavailable')).toBeVisible({ timeout: 30000 });
  await expect(assessment.getByText('Critical', { exact: true })).toBeVisible();
  await expect(assessment.getByText('Immediate danger reported')).toBeVisible();
  await assessment.screenshot({ path: run.outputPath('critical-case-review.png') });
});

test('request intelligence runs after submission and a case manager reviews the result', async ({ page, request }) => {
  const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
  test.skip(!password, 'Use the isolated acceptance runner.');
  const api = 'https://localhost:7143/api/v1';
  const lookup = await (await request.get(api + '/public/lookups?countryCode=LK')).json();
  const crisisId = lookup.crises.find((item: { name: string }) => item.name === 'Kelani River flood response').id;
  const login = await request.post(api + '/auth/login', { data: { email: 'citizen@surakuma.test', password } });
  expect(login.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const response = await request.post(api + '/requests', { headers, data: {
    crisisId, category: 'Other', priority: 'Normal', description: 'Synthetic flood exercise: someone is trapped and needs medical supplies.',
    locationText: 'Synthetic Kelaniya collection point', latitude: 6.95, longitude: 79.92, householdSize: 3,
    accessibilityNeeds: '', quantity: 2, unit: 'pieces', submissionKey: crypto.randomUUID(), synthetic: true,
  } });
  expect(response.status()).toBe(201);
  const submitted = await response.json();

  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('case@surakuma.test');
  await page.locator('input[name=password]').fill(password!);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('**/staff');
  await page.goto(`/staff/cases/${submitted.id}`);
  await expect(page.getByText('Urgency 100/100 · Rules-based score')).toBeVisible({ timeout: 90000 });
  const expectedProvider = process.env.SURAKUMA_ACCEPTANCE_AI_PROVIDER;
  if (expectedProvider) {
    const provenance = page.getByText(/Model: (OpenAI|Deterministic fallback)/);
    console.log('Synthetic triage provenance:', await provenance.textContent());
    await expect(provenance).toContainText(expectedProvider);
  } else await expect(page.getByText('Request analysis · Fallback')).toBeVisible();
  await expect(page.getByText('Immediate danger indicator (+100)')).toBeVisible();
  await page.getByRole('button', { name: 'Approve recommendation' }).click();
  await expect(page.getByText(/Human decision history/)).toBeVisible();

  await page.getByText('Draft a request update').click();
  await page.getByRole('button', { name: 'Generate update draft' }).click();
  const send = page.getByRole('button', { name: 'Send reviewed update' });
  await expect(send).toBeDisabled();
  await page.getByRole('checkbox', { name: /verified this wording/ }).check();
  await send.click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
});
