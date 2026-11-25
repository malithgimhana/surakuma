import { afterEach, expect, it } from 'vitest';
import { api, setToken } from '../api';

const originalAdapter = api.defaults.adapter;
afterEach(() => {
  api.defaults.adapter = originalAdapter;
  setToken(null);
});

it.each([
  ['/requests/case-id/recommendations/generate', 140000],
  ['/requests/case-id/communications', 75000],
  ['/volunteer-tasks/skill-suggestion', 75000],
  ['/crises/crisis-id/decision-support/forecasts', 75000],
  ['/crises/crisis-id/decision-support/briefings?countryCode=LK', 75000],
  ['/alerts/translation-draft?countryCode=LK', 140000],
  ['/requests', 25000],
  ['/crises/crisis-id/decision-support/briefings/briefing-id/review', 25000],
])('allows the appropriate wait for POST %s', async (path, expectedTimeout) => {
  api.defaults.adapter = async config => {
    expect(config.timeout).toBe(expectedTimeout);
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
  await api.post(path);
});

it('preserves an explicitly longer AI timeout', async () => {
  api.defaults.adapter = async config => {
    expect(config.timeout).toBe(180000);
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
  await api.post('/requests/case-id/recommendations/generate', {}, { timeout: 180000 });
});
