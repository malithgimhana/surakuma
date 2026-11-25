import { test, expect, type Page } from '@playwright/test';

test('shelter staff reserve, check in and check out a household and the citizen sees each change', async ({ page, browser, baseURL }, run) => {
  const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
  test.skip(!password || !baseURL, 'Uses the approved shelter request in the disposable seed.');
  async function login(actor: Page, account: string) {
    await actor.goto('/login');
    await actor.getByLabel('Email address', { exact: true }).fill(account + '@surakuma.test');
    await actor.getByLabel('Password', { exact: true }).fill(password!);
    await actor.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(actor).not.toHaveURL(/\/login$/);
  }
  const household = await browser.newContext({ baseURL });
  try {
    const citizen = await household.newPage();
    await login(citizen, 'citizen');
    await citizen.goto('/app/requests');
    const description = 'a household of four needs accessible temporary shelter';
    await citizen.getByRole('searchbox').fill(description);
    const result = citizen.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/requests/mine') && url.searchParams.get('search') === description;
    });
    await citizen.getByRole('button', { name: 'Search requests' }).click();
    const { items } = await (await result).json();
    expect(items).toHaveLength(1);
    const { id, reference } = items[0];
    await citizen.getByRole('main').getByRole('link', { name: new RegExp(reference) }).click();
    await login(page, 'shelter');
    await page.locator('.shelter-header-actions').getByRole('link', { name: 'Manage shelters' }).click();
    const facility = page.locator('.shelter-directory-card').filter({ has: page.getByRole('heading', { name: 'Riverside Community Centre' }) });
    await facility.getByRole('button', { name: 'Allocate household' }).click();
    const dialog = page.getByRole('dialog');
    const request = dialog.getByLabel('Approved shelter request');
    await expect(request.getByRole('option', { name: new RegExp(reference + ' · 4 people') })).toHaveCount(1);
    await request.selectOption(id);
    await dialog.getByRole('button', { name: 'Reserve spaces' }).click();
    await expect(dialog.getByText('Household reserved. Check-in is still required.')).toBeVisible();
    await citizen.reload();
    const placement = citizen.getByRole('region', { name: 'Shelter placements' });
    await expect(placement).toContainText('Riverside Community Centre');
    await expect(placement).toContainText('4 people');
    await expect(placement).toContainText('Reserved');
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await facility.getByRole('button', { name: 'View details' }).click();
    await dialog.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Check out' })).toBeVisible();
    await citizen.reload();
    await expect(placement).toContainText('Checked in');
    await citizen.screenshot({ path: run.outputPath('citizen-shelter-check-in.png'), fullPage: true });
    const departure = page.waitForResponse(response =>
      response.request().method() === 'POST' && /\/shelter-allocations\/[^/]+\/Depart\?/.test(response.url()));
    await dialog.getByRole('button', { name: 'Check out' }).click();
    expect((await departure).status()).toBe(200);
    await expect(dialog.getByText(/Checked out · Reserved/)).toBeVisible();
    await citizen.reload();
    await expect(placement).toContainText('Departed');
  } finally {
    await household.close();
  }
});
