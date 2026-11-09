import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const user = {
  id: 'demo',
  name: 'Demo User',
  email: 'demo@surakuma.test',
  language: 'en',
  roles: ['Coordinator', 'Citizen'],
  memberships: [{ id: 'm', organisationId: 'o', role: 'Coordinator' }],
  householdSize: 2,
  accessibilityNeeds: '',
};
const request = {
  id: 'r',
  reference: 'SK-DEMO',
  category: 'FoodWater',
  priority: 'High',
  description: 'A family needs assistance.',
  locationText: 'Demo area',
  latitude: null,
  longitude: null,
  householdSize: 2,
  accessibilityNeeds: '',
  quantity: 6,
  deliveredQuantity: 0,
  status: 'Submitted',
  organisationId: 'o',
};
const fixtures: Record<string, unknown> = {
  '/public/lookups': {
    crises: [{ id: 'c', name: 'Demo crisis', active: true }],
    organisations: [{ id: 'o', name: 'Demo organisation' }],
  },
  '/reports/metrics': {
    openCases: 4,
    overdueCases: 3,
    resolvedCases: 0,
    escalatedCases: 0,
    byStatus: [{ status: 'Submitted', count: 4 }],
    averageResponseHours: null,
    shelterOccupancy: 0,
    shelterCapacity: 250,
    shelterReserved: 0,
    resourceReserved: 0,
    resourceStock: 18,
    aiOverrideFrequency: 0,
    shortages: [],
  },
  '/requests/r': {
    request,
    history: [{ id: 'h', status: 'Submitted', note: 'Request received', createdAt: '2026-01-01' }],
    attachments: [],
    allocations: [],
    placements: [],
  },
  '/requests/r/recommendations': {
    recommendations: [
      {
        id: 'a',
        provider: 'Development rules',
        model: 'rules-v1',
        fallback: true,
        reviewState: 'Approve',
        priority: 'High',
        category: 'Medical',
        confidence: null,
        confidenceKind: 'Unavailable',
        explanation: 'Staff review required.',
      },
    ],
    decisions: [],
    duplicates: [],
  },
  '/resources': [
    {
      id: 'i',
      name: 'Family food packs',
      locationText: 'Demo depot',
      available: 6,
      reserved: 0,
      stock: 6,
      unit: 'packs',
      suitability: 'Family supplies',
    },
  ],
  '/shelters': [],
  '/alerts': [],
  '/requests/mine': { items: [], total: 0 },
};

async function mockApi(page: Page) {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    return route.fulfill({
      json: path === '/auth/refresh' ? { accessToken: 'test', user } : (fixtures[path] ?? []),
    });
  });
}

test('dark mode keeps request and staff screens readable', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => localStorage.setItem('surakuma.theme', 'dark'));
  for (const [path, visible] of [
    ['/app/requests/new', 'What do you need help with?'],
    ['/staff', 'Operational pulse'],
    ['/staff/cases/r', 'AI decision support'],
    ['/staff/resources', 'Family food packs'],
    ['/shelters', 'Find a shelter'],
    ['/login', 'Welcome back'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: visible }).first()).toBeVisible();
    const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    expect(results.violations, `Color contrast on ${path}`).toEqual([]);
    if (path === '/app/requests/new') {
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
      const details = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      expect(details.violations, 'Color contrast on request details').toEqual([]);
    }
  }
  const selection = await page.evaluate(() => {
    const style = getComputedStyle(document.body, '::selection');
    return { color: style.color, background: style.backgroundColor };
  });
  expect(selection).toEqual({ color: 'rgb(16, 25, 39)', background: 'rgb(169, 206, 255)' });
});
