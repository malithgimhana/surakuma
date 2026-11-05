import { chromium, request, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Node 24 runs this TypeScript directly. Never print the password or auth tokens.
const site = process.env.SURAKUMA_URL || 'http://localhost:5173';
const api = `${site}/api/v1`;
const output = resolve(import.meta.dirname, '../../output/demo');
mkdirSync(output, { recursive: true });
const settings = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../backend/data/development-settings.json'),
    'utf8',
  ),
);
const clients = new Map<string, Awaited<ReturnType<typeof request.newContext>>>();
async function client(account: string) {
  if (clients.has(account)) return clients.get(account)!;
  const session = await request.newContext({ ignoreHTTPSErrors: true });
  const login = await session.post(`${api}/auth/login`, {
    data: { email: `${account}@surakuma.test`, password: settings.Seed.Password },
  });
  if (!login.ok())
    throw new Error(`Preparation login failed for ${account}: HTTP ${login.status()}`);
  const auth = await login.json();
  await session.dispose();
  const authenticated = await request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: `Bearer ${auth.accessToken}` },
  });
  clients.set(account, authenticated);
  return authenticated;
}
async function call(account: string, path: string, data?: unknown, method = 'POST') {
  const response = await (await client(account)).fetch(`${api}/${path}`, { method, data });
  if (!response.ok()) throw new Error(`Preparation ${method} ${path}: HTTP ${response.status()}`);
  return response.status() === 204 ? null : response.json();
}

const system = await call('admin', 'admin/system', undefined, 'GET');
if (
  !system.integrations.some(
    (i: { id: string; state: string }) => i.id === 'ai' && i.state === 'Fallback',
  ) ||
  !system.integrations.some(
    (i: { id: string; state: string }) => i.id === 'email' && i.state === 'Capture',
  )
) {
  throw new Error(
    'This recording is designed for deterministic fallback and captured email. Do not silently record a live-send configuration.',
  );
}
const lookups = await call('citizen', 'public/lookups', undefined, 'GET');
const org = lookups.organisations.find(
  (o: { name: string }) => o.name === 'Surakuma Community Response (demo)',
);
const crisis = lookups.crises.find(
  (c: { name: string }) => c.name === 'Kelani River flood response',
);
if (!org || !crisis)
  throw new Error('The synthetic demonstration organisation and active flood crisis are required.');
const stamp = Date.now();
const description = `Synthetic recording ${stamp}: our household needs family food packs and clean drinking water after flooding.`;
const base = {
  organisationId: org.id,
  crisisId: crisis.id,
  priority: 'Normal',
  locationText: 'Synthetic Kelaniya collection point',
  latitude: 6.955,
  longitude: 79.92,
  householdSize: 4,
  accessibilityNeeds: 'Step-free access',
  synthetic: true,
};
// Prepare isolated synthetic inventory and a separate shelter need without resetting existing data.
const candidate = await call('citizen', 'requests', {
  ...base,
  category: 'FoodWater',
  quantity: 10,
  description,
  submissionKey: `record-candidate-${stamp}`,
});
const shelterCase = await call('citizen', 'requests', {
  ...base,
  category: 'Shelter',
  quantity: 1,
  description: `Synthetic recording ${stamp}: four people need accessible temporary shelter.`,
  submissionKey: `record-shelter-${stamp}`,
});
for (const status of ['UnderReview', 'Verified', 'Approved'])
  await call(
    'case',
    `requests/${shelterCase.id}/status`,
    {
      status,
      reason: 'Synthetic recording preparation: separate household shelter need verified.',
    },
    'PATCH',
  );
const resource = await call('logistics', 'resources', {
  organisationId: org.id,
  name: `Recording food packs ${stamp}`,
  category: 'FoodWater',
  unit: 'packs',
  stock: 6,
  locationText: 'Synthetic Colombo depot',
  latitude: 6.92,
  longitude: 79.88,
  suitability: 'Sealed family food packs; staff review',
  transportAvailable: true,
});
const shelter = await call('shelter', 'shelters', {
  organisationId: org.id,
  name: `Recording accessible shelter ${stamp}`,
  address: 'Synthetic Kelaniya location',
  latitude: 6.95,
  longitude: 79.92,
  capacity: 4,
  accessible: true,
  open: true,
  facilities: 'Step-free access, water and toilets',
});
const directory = await call('volunteers', 'volunteers', undefined, 'GET');
const volunteer = directory.profiles.find(
  (v: { verified: boolean; available: boolean; skills: string }) =>
    v.verified && v.available && v.skills.includes('distribution'),
);
if (!volunteer) throw new Error('A verified available synthetic distribution volunteer is needed.');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  recordVideo: { dir: resolve(output, 'raw'), size: { width: 1280, height: 900 } },
  ignoreHTTPSErrors: true,
  locale: 'en-GB',
  timezoneId: 'Asia/Colombo',
});
await context.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.id = 'recording-caption';
    bar.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#071841;color:white;padding:14px 30px;font:17px/1.4 Arial,sans-serif;pointer-events:none;box-shadow:0 -2px 12px #0002';
    bar.textContent =
      'SURAKUMA | Synthetic local demonstration | Captions only | External AI fallback and captured email';
    document.body.appendChild(bar);
  });
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const recording = page.video()!;
const started = Date.now();
const chapters: { seconds: number; text: string }[] = [];
async function caption(text: string, hold = 1700) {
  chapters.push({ seconds: (Date.now() - started) / 1000, text });
  await page.evaluate((text) => {
    const bar = document.getElementById('recording-caption');
    if (bar) bar.textContent = `SURAKUMA | ${text}`;
  }, text);
  await page.waitForTimeout(hold);
}
async function login(account: string) {
  await page.goto(`${site}/login`);
  await page.getByLabel('Email address', { exact: true }).fill(`${account}@surakuma.test`);
  await page.getByLabel('Password', { exact: true }).fill(settings.Seed.Password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes('login'));
}
async function switchAccount(account: string) {
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.waitForURL(`${site}/`);
  await login(account);
}
async function screenshot(name: string) {
  await page.screenshot({ path: resolve(output, `${name}.png`) });
}
let foodId = '';
try {
  await page.goto(site);
  await caption(
    'Public information and a responsive citizen interface. All locations and requests shown are synthetic.',
    2500,
  );
  await page.getByLabel('Language', { exact: true }).selectOption('si');
  await caption(
    'Sinhala public interface. Critical translations still require native-speaker review.',
    2000,
  );
  await page.getByRole('combobox').first().selectOption('ta');
  await caption(
    'Tamil public interface. Language keys are implemented; human review remains pending.',
    2000,
  );
  await page.getByRole('combobox').first().selectOption('en');
  await page.goto(`${site}/shelters`);
  await caption(
    'Shelters can be browsed without an account. Online map tiles and authenticated routing are separate services.',
    2400,
  );
  await login('citizen');
  await page.getByRole('link', { name: 'Request assistance', exact: true }).click();
  await caption(
    'Citizen submits a four-step food and water request. Evidence is optional and private.',
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Crisis event', { exact: true }).selectOption(crisis.id);
  await page.getByLabel('Receiving organisation', { exact: true }).selectOption(org.id);
  await page.getByLabel('Describe what you need', { exact: true }).fill(description);
  await page.getByLabel('Quantity needed', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Location', { exact: true }).fill(base.locationText);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('This request uses synthetic demonstration information only.').check();
  await caption('Review and explicitly confirm synthetic demonstration data before submission.');
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Your request has been received' }),
  ).toBeVisible();
  foodId = page.url().split('/').pop()!;
  await caption('The persisted request has a reference and citizen timeline.', 2400);
  await switchAccount('case');
  await page.goto(`${site}/staff/cases/${foodId}`);
  await page.getByRole('button', { name: 'Begin review', exact: true }).click();
  await page.getByRole('button', { name: 'Verify request', exact: true }).click();
  await expect(page.locator('.page-header').getByText('Verified', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Generate recommendation', exact: true }).click();
  await expect(page.getByText('DEVELOPMENT RULES FALLBACK · not external AI')).toBeVisible({
    timeout: 20000,
  });
  await caption(
    'No API key is configured. This is labelled deterministic fallback, not a successful external AI call.',
    2600,
  );
  const duplicate = page
    .locator('.recommendation')
    .filter({ has: page.locator(`a[href="/staff/cases/${candidate.id}"]`) });
  await duplicate.scrollIntoViewIfNeeded();
  await caption(
    'A possible duplicate uses token similarity. Staff review it; the other request is preserved.',
  );
  await duplicate.getByRole('button', { name: 'Distinct', exact: true }).click();
  await page.getByLabel('Final priority for modification', { exact: true }).selectOption('High');
  await page
    .getByLabel('Decision / override reason', { exact: true })
    .fill('Staff confirmed an elderly household member needs priority support.');
  await page.getByRole('button', { name: 'Modify', exact: true }).click();
  await caption(
    'Human override is recorded with a reason. Case approval is a separate authorised decision.',
  );
  await page.getByRole('button', { name: 'Approve case', exact: true }).click();
  await switchAccount('logistics');
  await page.goto(`${site}/staff/cases/${foodId}`);
  await page.getByLabel('Resource', { exact: true }).selectOption(resource.id);
  await page.getByLabel('Quantity', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Approve reservation', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await caption(
    'Only six packs exist. A ten-pack reservation is rejected by the server; stock remains protected.',
    2600,
  );
  await page.getByLabel('Quantity', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Approve reservation', exact: true }).click();
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delivery', exact: true }).click();
  await expect(page.getByText('6 / 10', { exact: true })).toBeVisible();
  await caption(
    'Six of ten delivered. Four remain outstanding; reservation, dispatch and delivery are separate records.',
    2700,
  );
  await screenshot('partial-delivery');
  await switchAccount('shelter');
  await page.goto(`${site}/staff/cases/${shelterCase.id}`);
  await page.getByLabel('Suitable shelter', { exact: true }).selectOption(shelter.id);
  await caption(
    'The same household has a separate approved shelter request. Four accessible spaces fit the whole household.',
  );
  await page.getByRole('button', { name: 'Approve household reservation', exact: true }).click();
  await caption('Reservation commits capacity before arrival. It is not occupancy.');
  await page.getByRole('button', { name: 'CheckIn', exact: true }).click();
  await caption(
    'Check-in converts the reservation to occupancy. Departure will release the occupied spaces.',
  );
  await screenshot('shelter-check-in');
  await switchAccount('volunteers');
  await page.goto(`${site}/staff/volunteers`);
  await page.getByLabel('Case ID', { exact: true }).fill(foodId);
  await page.getByLabel('Verified volunteer', { exact: true }).selectOption(volunteer.id);
  const taskTitle = `Recording household distribution ${stamp}`;
  await page.getByLabel('Task title', { exact: true }).fill(taskTitle);
  await page.getByLabel('Required skill', { exact: true }).fill('distribution');
  await page
    .getByLabel('Due date and time', { exact: true })
    .fill(new Date(Date.now() + 86400000 + 330 * 60000).toISOString().slice(0, 16));
  await page.getByRole('button', { name: 'Assign task', exact: true }).click();
  await expect(page.getByRole('heading', { name: taskTitle, exact: true })).toBeVisible();
  await caption('The volunteer coordinator assigns work using verified skills and availability.');
  await switchAccount('volunteer');
  const taskCard = page
    .locator('.card')
    .filter({ has: page.getByRole('heading', { name: taskTitle, exact: true }) });
  await taskCard.getByRole('button', { name: 'Accept', exact: true }).click();
  await taskCard.getByRole('button', { name: 'Start', exact: true }).click();
  await taskCard.getByRole('button', { name: 'Submit for verification', exact: true }).click();
  await caption(
    'The volunteer accepts, starts and reports completion. They cannot verify their own work.',
  );
  await switchAccount('volunteers');
  await page.goto(`${site}/staff/volunteers`);
  const staffTask = page
    .locator('.card')
    .filter({ has: page.getByRole('heading', { name: taskTitle, exact: true }) });
  await staffTask.getByRole('button', { name: 'Verify', exact: true }).click();
  await caption('The coordinator verifies completion and the activity remains auditable.');
  await switchAccount('logistics');
  await page.goto(`${site}/staff/resources`);
  const stock = page
    .locator('.card')
    .filter({ has: page.getByRole('heading', { name: resource.name, exact: true }) });
  await stock.getByLabel(`Replenish ${resource.name} quantity`, { exact: true }).fill('4');
  await stock
    .getByLabel('Replenishment reason', { exact: true })
    .fill('Synthetic incoming aid resolves the shortage.');
  await stock.getByRole('button', { name: 'Add stock', exact: true }).click();
  await expect(stock.locator('.stock-numbers')).toContainText('4');
  await caption(
    'Replenishment is recorded with a reason. It does not erase the earlier shortage or delivery history.',
  );
  await page.goto(`${site}/staff/cases/${foodId}`);
  await page.getByLabel('Resource', { exact: true }).selectOption(resource.id);
  await page.getByLabel('Quantity', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Approve reservation', exact: true }).click();
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delivery', exact: true }).click();
  await expect(page.getByText('10 / 10', { exact: true })).toBeVisible();
  await caption('The remaining four packs are delivered. The requested quantity is now fulfilled.');
  await switchAccount('case');
  await page.goto(`${site}/staff/cases/${foodId}`);
  await page
    .getByLabel('Reason / case note', { exact: true })
    .fill('Staff confirmed full delivery and volunteer completion.');
  await page.getByRole('button', { name: 'Close completed case', exact: true }).click();
  await expect(page.locator('.page-header').getByText('Completed', { exact: true })).toBeVisible();
  await caption(
    'Authorised staff close the fulfilled case. The original request and history remain available.',
  );
  await switchAccount('citizen');
  await page.goto(`${site}/app/requests/${foodId}`);
  await page.getByLabel('I received the assistance', { exact: true }).check();
  await page
    .getByLabel('Your comments', { exact: true })
    .fill('Synthetic household receipt confirmed.');
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await caption(
    'Citizen confirms receipt and can report a problem. Their timeline preserves operational changes.',
  );
  await page.goto(`${site}/app/notifications`);
  await caption(
    'In-app updates persist through the SQL outbox. Capture mode does not send a real email.',
    2600,
  );
  await switchAccount('coordinator');
  await caption(
    'Operational metrics come from authorised database records, including shortages, occupancy and AI overrides.',
    2600,
  );
  await screenshot('metrics');
  await switchAccount('admin');
  await expect(page.getByRole('heading', { name: 'Integration readiness' })).toBeVisible();
  await caption(
    'Administrator sees configuration modes and notification queue counts. Configured would still require live validation.',
    2700,
  );
  await page.getByRole('heading', { name: 'Recent audit events' }).scrollIntoViewIfNeeded();
  await caption(
    'Audit records preserve responsible actors and decisions. No live AI, email or routing success is claimed.',
    3000,
  );
  await screenshot('audit');
  chapters.push({
    seconds: (Date.now() - started) / 1000,
    text: 'End of recorded browser walkthrough.',
  });
  await context.close();
  await recording.saveAs(resolve(output, 'Surakuma-walkthrough.webm'));
  const timestamp = (seconds: number) =>
    `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0')}:${Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0')}`;
  writeFileSync(
    resolve(output, 'walkthrough-transcript.md'),
    '# Recorded browser walkthrough\n\nSilent recording with on-screen captions. All scenarios are synthetic. External AI uses deterministic fallback, email is captured, and routing is unconfigured. Preparation created isolated synthetic stock, a duplicate candidate and an approved separate shelter need without resetting existing data. Times below are approximate chapter starts.\n\n' +
      chapters.map((c) => `- ${timestamp(c.seconds)} ${c.text}`).join('\n') +
      '\n',
  );
  writeFileSync(
    resolve(output, 'recording-evidence.json'),
    JSON.stringify(
      {
        scenario: 'Synthetic full household walkthrough',
        runtimeTimestamp: new Date().toISOString(),
        elapsedSeconds: chapters.at(-1)!.seconds,
        foodRequestId: foodId,
        shelterRequestId: shelterCase.id,
        resourceId: resource.id,
        shelterId: shelter.id,
        externalAi: 'Fallback',
        email: 'Capture',
        narration: false,
        chapters,
      },
      null,
      2,
    ),
  );
  console.log(`Recorded browser walkthrough and transcript in ${output}`);
} catch (error) {
  await page
    .screenshot({ path: resolve(output, 'recording-failure.png'), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await context.close().catch(() => {});
  await browser.close();
  for (const item of clients.values()) await item.dispose();
}
