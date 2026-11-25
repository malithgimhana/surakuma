import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../i18n';
import i18n from '../i18n';
import { Badge, ErrorState } from '../components';
import { NewRequest } from '../CitizenPages';
import { api, get } from '../api';
vi.mock('../auth', () => ({
  useAuth: () => ({ user: { id: 'test', householdSize: 4, accessibilityNeeds: '' } }),
}));
const map = vi.hoisted(() => ({ setView: vi.fn(), getZoom: () => 12 }));
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  CircleMarker: () => null,
  Popup: () => null,
  useMap: () => map,
  useMapEvents: () => null,
}));
vi.mock('../api', () => ({
  get: vi.fn().mockResolvedValue({
    crises: [{ id: 'crisis', name: 'Demo flood' }],
    organisations: [{ id: 'org', name: 'Demo organisation' }],
  }),
  api: { post: vi.fn() },
  errorMessage: () => 'Technical service failure',
}));
const defaultGet = vi.mocked(get).getMockImplementation()!;
beforeEach(() => {
  cleanup();
  vi.mocked(get).mockReset().mockImplementation(defaultGet);
  vi.mocked(api.post).mockReset();
  map.setView.mockClear();
  sessionStorage.clear();
  void i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());
describe('Citizen accessibility and workflows', () => {
  it.each([
    ['Food & water', 'Which item do you need?'], ['Medical help', 'What medical help is needed?'],
    ['Temporary shelter', 'Do you have a safe place to stay tonight?'], ['Transportation', 'When do you need to leave?'],
    ['Accessibility support', 'Which service do you need to access?'], ['Other assistance', 'What do you need help with?'],
  ])('shows the relevant details for %s', async (type, question) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><NewRequest /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(type.replace('&', '\\&'), 'i') }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByLabelText(question)).toBeVisible();
    expect(screen.queryByLabelText('How urgent is this?')).toBeNull();
    if (type !== 'Food & water') expect(screen.queryByLabelText('Measurement unit')).toBeNull();
  });

  it('reviews and submits four food and water items with independent quantities and units', async () => {
    vi.mocked(get).mockImplementation((...args) => args[0] === '/public/resource-units'
      ? Promise.resolve(['l', 'packs', 'pieces'].map(code => ({ code, label: code, stockCategories: ['FoodWater'] })))
      : defaultGet(...args));
    vi.mocked(api.post).mockResolvedValueOnce({ data: { id: 'submitted-request' } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><NewRequest /></MemoryRouter></QueryClientProvider>);
    const next = screen.getByRole('button', { name: 'Continue' });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /^Food & water/ }));
    fireEvent.click(next);
    fireEvent.change(await screen.findByLabelText('Crisis event'), { target: { value: 'crisis' } });
    const add = screen.getByRole('button', { name: 'Add another item' });
    for (let i = 0; i < 3; i++) fireEvent.click(add);
    expect(add).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 2' }));
    expect(add).toBeEnabled();
    fireEvent.click(add);
    const items = [
      { item: 'Water', quantity: 2.5, unit: 'l' },
      { item: 'DryRations', quantity: 3, unit: 'packs' },
      { item: 'Blankets', quantity: 2, unit: 'pieces' },
      { item: 'Hygiene', quantity: 4, unit: 'packs' },
    ];
    for (const [index, line] of items.entries()) {
      const row = within(screen.getByRole('group', { name: `Item ${index + 1}` }));
      fireEvent.change(row.getByLabelText('Which item do you need?'), { target: { value: line.item } });
      fireEvent.change(row.getByLabelText('Measurement unit'), { target: { value: line.unit } });
      fireEvent.change(row.getByLabelText('Quantity needed'), { target: { value: String(line.quantity) } });
    }
    fireEvent.change(screen.getByLabelText('When is the most urgent item needed?'), { target: { value: 'WithinDay' } });
    fireEvent.change(screen.getByLabelText('Describe what you need'), { target: { value: 'Food and supplies for the household.' } });
    fireEvent.click(next);
    fireEvent.change(await screen.findByLabelText('Location'), { target: { value: 'Gampaha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Drinking water · 2.5 L')).toBeVisible();
    expect(screen.getByText('Dry rations · 3 packs')).toBeVisible();
    expect(screen.getByText('Blankets · 2 pieces')).toBeVisible();
    expect(screen.getByText('Hygiene supplies · 4 packs')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/requests',
      expect.objectContaining({ category: 'FoodWater', intake: expect.objectContaining({ supplyItems: items }) })));
  });

  it('preserves the item, quantity, and unit in an older food and water draft', async () => {
    vi.mocked(get).mockImplementation((...args) => args[0] === '/public/resource-units'
      ? Promise.resolve([{ code: 'l', label: 'Litres', stockCategories: ['FoodWater'] }])
      : defaultGet(...args));
    sessionStorage.setItem('surakuma.draft.test', JSON.stringify({
      category: 'FoodWater', crisisId: 'crisis', intake: { need: 'Water', timing: 'WithinDay' }, quantity: 2.5, unit: 'l',
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><NewRequest /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByLabelText('Which item do you need?')).toHaveValue('Water');
    expect(screen.getByLabelText('Quantity needed')).toHaveValue(2.5);
    await waitFor(() => expect(screen.getByLabelText('Measurement unit')).toHaveValue('l'));
    expect(screen.getByLabelText('When will it run out?')).toHaveValue('WithinDay');
  });

  it('offers emergency contacts without leaving a medical request when someone is in immediate danger', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><NewRequest /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole('radio', { name: /Medical help/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('radio', { name: /^Yes$/ }));
    const contacts = screen.getByRole('link', { name: /View emergency contacts/ });
    expect(contacts).toHaveAttribute('href', '/contact');
    expect(contacts).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('radio', { name: /^No$/ }));
    expect(screen.queryByRole('link', { name: /View emergency contacts/ })).toBeNull();
  });

  it('communicates status in text and provides a retry action', () => {
    const retry = vi.fn();
    render(
      <>
        <Badge value="PartiallyFulfilled" />
        <ErrorState error={new Error('offline')} retry={retry} />
      </>,
    );
    expect(screen.getByText('Partially delivered')).toHaveClass('amber');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('does not advance past missing request details and keeps the draft', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <NewRequest />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: /^Food & water/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('Describe what you need');
    const next = screen.getByRole('button', { name: 'Continue' });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await waitFor(() =>
      expect(
        screen.getAllByText('Please complete the required fields correctly.').length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getByLabelText('Describe what you need')).toBeVisible();
    expect(sessionStorage.getItem('surakuma.draft.test.LK')).toContain('FoodWater');
  });
  it('reviews a real request without requiring a fictional-data checkbox and explains how its text is handled', async () => {
    sessionStorage.setItem('surakuma.draft.test', JSON.stringify({
      category: 'Shelter', crisisId: 'crisis', description: 'Our household needs a place to stay.',
      locationText: 'Panadura', synthetic: false,
      intake: { safeTonight: 'No', travelHelp: 'No' },
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}>
      <MemoryRouter><NewRequest /></MemoryRouter>
    </QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('Describe your situation');
    expect(screen.queryByLabelText('Measurement unit')).toBeNull();
    expect(screen.queryByLabelText('How urgent is this?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('Location');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('button', { name: 'Submit request' })).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: /fictional information/i })).toBeNull();
    expect(screen.getByText(/Location searches and address lookups use a mapping provider/)).toBeVisible();
    expect(sessionStorage.getItem('surakuma.draft.test.LK')).toContain('"synthetic":false');
    expect(sessionStorage.getItem('surakuma.draft.test')).toBeNull();
  });
  it('fills the Location box with the first GPS address and keeps the pin when lookup fails', async () => {
    sessionStorage.setItem('surakuma.draft.test', JSON.stringify({
      category: 'Shelter', crisisId: 'crisis', description: 'We need a place to stay.',
      latitude: 7.08, longitude: 79.99, locationText: '7.08000, 79.99000',
      intake: { safeTonight: 'No', travelHelp: 'No' },
    }));
    vi.mocked(get).mockImplementation(path => path === '/countries/LK/divisions'
      ? Promise.resolve([{ id: 'gampaha', name: 'Gampaha', levelName: 'District', parentId: null }])
      : defaultGet(path));
    const latitude = 7.0912345, longitude = 79.9987654;
    vi.stubGlobal('navigator', { geolocation: {
      getCurrentPosition: (success: PositionCallback) =>
        success({ coords: { latitude, longitude } } as GeolocationPosition),
    } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><NewRequest /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('Describe your situation');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const location = await screen.findByLabelText('Location', { exact: true });
    expect(await screen.findByRole('option', { name: /^Gampaha$/ })).toBeInTheDocument();
    expect(location).toHaveValue('');

    const gps = screen.getByRole('button', { name: 'Use my location' });
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Address lookup failed'));
    fireEvent.click(gps);
    expect(await screen.findByText(/your map pin is set/i)).toBeVisible();
    expect(location).toHaveValue('');
    expect(map.setView).toHaveBeenLastCalledWith([latitude, longitude], 12, { animate: false });
    vi.mocked(api.post).mockResolvedValueOnce({ data: { features: [
      { properties: { label: 'Test address, Gampaha' }, geometry: { coordinates: [79.999, 7.092] } },
      { properties: { label: 'Alternate address, Gampaha' }, geometry: { coordinates: [79.998, 7.091] } },
    ] } });
    fireEvent.click(gps);
    await waitFor(() => expect(location).toHaveValue('Test address, Gampaha'));
    expect(api.post).toHaveBeenLastCalledWith('/maps/reverse-geocode?countryCode=LK', { latitude, longitude });
    expect(map.setView).toHaveBeenLastCalledWith([latitude, longitude], 12, { animate: false });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Test address, Gampaha')).toBeVisible();
  });

  it('automatically fills the first search result and lets citizens choose another match', async () => {
    sessionStorage.setItem('surakuma.draft.test', JSON.stringify({
      category: 'Shelter', crisisId: 'crisis', description: 'We need a place to stay.',
      locationText: 'Panadura', latitude: 6.8263, longitude: 79.8811,
      intake: { safeTonight: 'No', travelHelp: 'No' },
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><NewRequest /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('Describe your situation');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const searchButton = await screen.findByRole('button', { name: /search location/i });
    const searchBox = screen.getByRole('textbox', { name: /search location/i });
    const geocode = vi.fn();
    vi.mocked(get).mockImplementation(path => path.startsWith('/maps/geocode?') ? geocode(path) : defaultGet(path));
    geocode.mockResolvedValueOnce({ features: [] });
    fireEvent.change(searchBox, { target: { value: '  Colombo Fort  ' } });
    fireEvent.keyDown(searchBox, { key: 'Enter' });
    expect(await screen.findByText(/no matching places/i)).toBeVisible();
    expect(get).toHaveBeenCalledWith('/maps/geocode?query=Colombo%20Fort&countryCode=LK');

    geocode.mockRejectedValueOnce(new Error('Provider unavailable'));
    fireEvent.click(searchButton);
    expect(await screen.findByText(/location search is unavailable/i)).toBeVisible();

    geocode.mockResolvedValueOnce({ features: [
      { properties: { label: 'Colombo Fort, Sri Lanka' }, geometry: { coordinates: [79.85, 6.93] } },
    ] });
    fireEvent.click(searchButton);
    expect(await screen.findByDisplayValue('Colombo Fort, Sri Lanka')).toBeVisible();
    await waitFor(() => {
      expect(map.setView).toHaveBeenLastCalledWith([6.93, 79.85], 12, { animate: false });
      expect(sessionStorage.getItem('surakuma.draft.test.LK')).toContain('"latitude":6.93');
    });

    geocode.mockResolvedValueOnce({ features: [
      { properties: { label: 'Colombo, Sri Lanka' }, geometry: { coordinates: [79.857, 6.922] } },
      { properties: { label: 'Pettah, Sri Lanka' }, geometry: { coordinates: [79.852, 6.931] } },
    ] });
    fireEvent.change(searchBox, { target: { value: 'Colombo' } });
    fireEvent.click(searchButton);
    expect(await screen.findByText('First match filled in. Choose another result if needed.')).toBeVisible();
    expect(screen.getByLabelText('Location', { exact: true })).toHaveValue('Colombo, Sri Lanka');
    await waitFor(() => expect(map.setView).toHaveBeenLastCalledWith([6.922, 79.857], 12, { animate: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Pettah, Sri Lanka' }));
    expect(screen.getByDisplayValue('Pettah, Sri Lanka')).toBeVisible();
    expect(map.setView).toHaveBeenLastCalledWith([6.931, 79.852], 12, { animate: false });
  });
  it('provides clear delivery steps in every language', () => {
    for (const language of ['en', 'si', 'ta']) {
      for (const status of ['Reserved', 'Dispatched', 'Delivered']) {
        expect(i18n.getResource(language, 'translation', 'delivery.' + status)).toBeTruthy();
      }
    }
  });
  it('provides the same nonempty interface keys in all three languages', () => {
    const english = i18n.getResourceBundle('en', 'translation') as Record<string, string>;
    for (const language of ['si', 'ta']) {
      const bundle = i18n.getResourceBundle(language, 'translation') as Record<string, string>;
      expect(Object.keys(bundle).sort()).toEqual(Object.keys(english).sort());
      expect(Object.values(bundle).every((value) => value.trim().length > 0)).toBe(true);
    }
  });
});
