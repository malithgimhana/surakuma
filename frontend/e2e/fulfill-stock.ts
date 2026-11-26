import { expect, type APIRequestContext, type Page } from '@playwright/test';

export async function fulfillStock(page: Page, request: APIRequestContext, requestId: string, item: string,
  name: string, unit: string, quantity: number) {
  await page.getByRole('button', { name: `Review stock for ${item}` }).click();
  const source = page.getByLabel('Stock source', { exact: true });
  const option = source.getByRole('option').filter({ hasText: name });
  await expect(option).toHaveCount(1);
  await source.selectOption(await option.getAttribute('value') as string);
  const amount = page.getByLabel(`Quantity (${unit})`, { exact: true });
  await expect(amount).toHaveAttribute('max', String(quantity));
  await amount.fill(String(quantity));
  await page.getByRole('button', { name: 'Reserve item', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm packing & schedule', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason').fill('Counted and packed the reserved supplies.');
  await dialog.getByRole('button', { name: 'Confirm packing' }).click();
  const dispatched = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/dispatches'));
  await page.getByRole('button', { name: 'Dispatch selected items to centre' }).click();
  const response = await dispatched;
  expect(response.ok()).toBeTruthy();
  const dispatch = await response.json();
  const shipment = page.getByRole('region', { name: dispatch.reference });
  await shipment.getByText('Record centre receipt', { exact: true }).click();
  const amountReceived = shipment.getByRole('spinbutton');
  const allocationId = await amountReceived.getAttribute('name');
  expect(allocationId).toBeTruthy();
  await expect(amountReceived).toHaveAttribute('max', String(quantity));
  await amountReceived.fill(String(quantity));
  await shipment.getByRole('button', { name: 'Confirm centre receipt' }).click();
  await expect(shipment.getByText('At the centre, awaiting volunteer handover')).toBeVisible();
  await verifyVolunteerHandover(request, requestId, dispatch.id, allocationId!, quantity);
  await page.reload();
}

export function caseItemQuantity(page: Page, label: string) {
  return page.locator('.logistics-case-item-quantities > div')
    .filter({ has: page.getByText(label, { exact: true }) }).getByRole('definition');
}

export async function verifyVolunteerHandover(request: APIRequestContext, requestId: string, dispatchId: string,
  allocationId: string, quantity: number) {
  const api = '/api/v1';
  const scope = '?countryCode=LK&staffRole=VolunteerCoordinator';
  const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
  async function post(path: string, data: unknown, headers?: Record<string, string>) {
    const response = await request.post(api + path, { data, headers });
    expect(response.ok(), `${path} returned ${response.status()}`).toBeTruthy();
    return response;
  }
  async function signIn(email: string) {
    const response = await post('/auth/login', { email, password });
    return { Authorization: `Bearer ${(await response.json()).accessToken}` };
  }

  const coordinator = await signIn('volunteers@surakuma.test');
  const email = `handover-${dispatchId}@surakuma.test`;
  const volunteer = await (await post('/volunteers/task-registration' + scope, {
    requestId, caseDispatchId: dispatchId, name: 'Synthetic handover volunteer', email, password,
    profile: { skills: 'distribution', available: true },
  }, coordinator)).json();
  await post(`/volunteers/${volunteer.id}/verify${scope}`, {}, coordinator);
  const task = await (await post('/volunteer-tasks' + scope, {
    requestId, caseDispatchId: dispatchId, volunteerId: volunteer.id, title: 'Hand over synthetic supplies',
    requiredSkill: 'distribution', dueAt: new Date(Date.now() + 7200000).toISOString(),
  }, coordinator)).json();
  const field = await signIn(email);
  const taskPath = `/volunteer-tasks/${task.id}`;
  for (const action of ['Accept', 'Start']) await post(taskPath, { action }, field);
  await post(taskPath, {
    action: 'Complete', workDescription: 'Collected the checked supplies at the centre.',
    outcome: 'Handed the supplies to the synthetic household.', issues: '', handoverQuantities: [{ allocationId, quantity }],
  }, field);
  await post(taskPath + scope, { action: 'Verify', note: 'Verified the synthetic handover.' }, coordinator);
}
