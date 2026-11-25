import { expect, test, type Page } from '@playwright/test';

const scenarios = [
  {
    category: 'Transportation', descriptionLabel: 'Describe what you need',
    choices: [['Where do you need to go?', 'SafePlace'], ['When do you need to leave?', 'Now'],
      ['What vehicle support do you need?', 'Wheelchair']],
    expected: ['To a safe place', 'Space for a wheelchair', 'Synthetic relief centre'],
  },
  {
    category: 'Accessibility', descriptionLabel: 'Describe what would help',
    choices: [['What support do you need?', 'SignLanguage'], ['Which service do you need to access?', 'Distribution'],
      ['When do you need this support?', 'Today']],
    expected: ['Sign language interpretation', 'Aid distribution'],
  },
  {
    category: 'Shelter', descriptionLabel: 'Describe your situation',
    choices: [['Do you have a safe place to stay tonight?', 'No']],
    expected: ['Step-free entrance', 'Do you need help getting there?'],
  },
  {
    category: 'Other', descriptionLabel: 'What do you need help with?',
    choices: [['When do you need help?', 'NoDeadline']],
    expected: ['No fixed deadline'],
  },
];

for (const { category, descriptionLabel, choices, expected } of scenarios) {
  test(`${category} intake answers reach the assigned case manager`, async ({ page, browser, baseURL }) => {
    const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
    test.skip(!password || !baseURL, 'Requires the disposable acceptance database.');
    async function login(actor: Page, account: string) {
      await actor.getByLabel('Email address', { exact: true }).fill(account + '@surakuma.test');
      await actor.getByLabel('Password', { exact: true }).fill(password!);
      await actor.getByRole('button', { name: 'Log in', exact: true }).click();
    }
    await page.goto('/');
    await page.locator(`a[href="/app/requests/new?category=${category}"]`).click();
    await login(page, 'citizen');
    await expect(page.locator(`input[value="${category}"]`)).toBeChecked();
    const next = page.getByRole('button', { name: 'Continue', exact: true });
    await next.click();
    await page.getByLabel('Crisis event').selectOption({ label: 'Kelani River flood response' });
    for (const [question, answer] of choices) await page.getByLabel(question, { exact: true }).selectOption(answer);
    if (category === 'Shelter') {
      await page.getByLabel('Step-free entrance').check();
      await page.getByRole('radio', { name: 'Yes', exact: true }).check();
    }
    const description = `Synthetic ${category.toLowerCase()} request for the household workflow rehearsal.`;
    await page.getByLabel(descriptionLabel, { exact: true }).fill(description);
    await next.click();
    await page.getByLabel(category === 'Transportation' ? 'Pickup point' : 'Location', { exact: true }).fill('Synthetic collection point');
    if (category === 'Transportation') await page.getByLabel('Destination', { exact: true }).fill('Synthetic relief centre');
    await next.click();
    for (const answer of expected) await expect(page.getByRole('main').getByText(answer, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Your request has been received' })).toBeVisible();
    const caseId = new URL(page.url()).pathname.split('/').pop();
    await page.reload();
    await page.getByText('View your submitted answers', { exact: true }).click();
    for (const answer of expected) await expect(page.locator('.citizen-submitted-answers')).toContainText(answer);
    const staff = await browser.newContext({ baseURL });
    try {
      const manager = await staff.newPage();
      await manager.goto('/login');
      await login(manager, 'case');
      await manager.waitForURL('/staff');
      await manager.goto(`/staff/cases/${caseId}`);
      const triage = manager.locator('.citizen-triage-card');
      await expect(triage).toContainText(description);
      await triage.getByText('View intake answers', { exact: true }).click();
      for (const answer of expected) await expect(triage.locator('details[open]')).toContainText(answer);
    } finally {
      await staff.close();
    }
  });
}
