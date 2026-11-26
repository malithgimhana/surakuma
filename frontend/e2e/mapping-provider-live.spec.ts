import { expect, test } from '@playwright/test';

test('mapping provider returns public landmark results or an explicit manual fallback', async ({ request, baseURL }, run) => {
  const password = process.env.SURAKUMA_ACCEPTANCE_PASSWORD;
  test.skip(!password || !baseURL, 'Requires the isolated Surakuma acceptance database.');
  const api = `${baseURL}/api/v1`;
  const live = process.env.SURAKUMA_ACCEPTANCE_LIVE_MAPPING === '1';
  const observations: { check: string; status: number; results?: number; distanceMeters?: number }[] = [];

  for (const [countryCode, query] of [['LK', 'Colombo Fort Railway Station'], ['IN', 'India Gate'], ['NP', 'Kathmandu Durbar Square']]) {
    const response = await request.get(`${api}/maps/geocode`, { params: { countryCode, query } });
    const data = await response.json();
    observations.push({ check: `${countryCode} landmark search`, status: response.status(), results: data.features?.length });
    expect(response.status()).toBe(live ? 200 : 503);
    if (live) expect(data.features.length).toBeGreaterThan(0);
    else expect(data.title).toContain('Enter a location');
  }

  const login = await request.post(`${api}/auth/login`, { data: { email: 'logistics@surakuma.test', password } });
  expect(login.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const reverse = await request.post(`${api}/maps/reverse-geocode?countryCode=LK`, {
    headers, data: { latitude: 6.9347, longitude: 79.8501 },
  });
  const reverseData = await reverse.json();
  observations.push({ check: 'LK reverse geocode', status: reverse.status(), results: reverseData.features?.length });
  expect(reverse.status()).toBe(live ? 200 : 503);
  if (live) expect(reverseData.features.length).toBeGreaterThan(0);

  const route = await request.get(`${api}/maps/route`, {
    headers, params: { startLat: 6.9347, startLng: 79.8501, endLat: 6.9259, endLng: 79.8558 },
  });
  const routeData = await route.json();
  const distanceMeters = routeData.routes?.[0]?.summary?.distance ?? routeData.features?.[0]?.properties?.summary?.distance;
  observations.push({ check: 'LK ordinary driving route', status: route.status(), distanceMeters });
  expect(route.status()).toBe(live ? 200 : 503);
  expect(route.headers()['x-surakuma-route-type']).toBe('ordinary-driving');
  if (live) expect(distanceMeters).toBeGreaterThan(0);

  await run.attach('mapping-observations', {
    body: JSON.stringify({ mode: live ? 'live provider' : 'manual fallback', utc: new Date().toISOString(), observations }, null, 2),
    contentType: 'application/json',
  });
});
