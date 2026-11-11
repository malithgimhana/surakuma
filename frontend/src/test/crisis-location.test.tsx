import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import { CrisesPage } from '../StaffSupport';
import { api } from '../api';

vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'coordinator', roles: ['Coordinator'] } }) }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => Promise.resolve(path === '/countries/LK/divisions' ? [{id:'gampaha',name:'Gampaha',levelName:'District',parentId:null}] : path === '/public/lookups' ? { crises: [], organisations: [] } : [])),
  api: { request: vi.fn().mockResolvedValue({ data: {} }) },
  errorMessage: () => 'Error',
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function openForm() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CrisesPage /></MemoryRouter>
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Create crisis' }));
}

it('loads country regions and uses the current location in the submitted crisis', async () => {
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: 7.09, longitude: 79.99 } } as GeolocationPosition) } });
  openForm();
  const district = await screen.findByLabelText('Administrative region');
  await waitFor(() => expect(within(district).getAllByRole('option')).toHaveLength(2));
  fireEvent.change(screen.getByLabelText('Crisis name'), { target: { value: 'Gampaha response' } });
  fireEvent.change(district, { target: { value: 'gampaha' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use my current location' }));
  expect(screen.getByLabelText('Latitude')).toHaveValue(7.09);
  expect(screen.getByLabelText('Longitude')).toHaveValue(79.99);
  fireEvent.click(screen.getByRole('button', { name: 'Create response event' }));
  await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ url: '/crises', data: expect.objectContaining({ countryCode: 'LK', administrativeDivisionId: 'gampaha', latitude: 7.09, longitude: 79.99 }) })));
});

it('keeps manual coordinates if a pending location lookup returns late', () => {
  let success!: PositionCallback;
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: (callback: PositionCallback) => { success = callback; } } });
  openForm();
  fireEvent.click(screen.getByRole('button', { name: 'Use my current location' }));
  fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '8.5' } });
  fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '80.5' } });
  success({ coords: { latitude: 7, longitude: 79 } } as GeolocationPosition);
  expect(screen.getByLabelText('Latitude')).toHaveValue(8.5);
  expect(screen.getByLabelText('Longitude')).toHaveValue(80.5);
});

it('offers manual entry when location access fails', () => {
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) => failure({} as GeolocationPositionError) } });
  openForm();
  fireEvent.click(screen.getByRole('button', { name: 'Use my current location' }));
  expect(screen.getByRole('alert')).toHaveTextContent('enter the coordinates manually');
  fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '6.93' } });
  fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '79.88' } });
  expect(screen.getByLabelText('Latitude')).toHaveValue(6.93);
  expect(screen.getByLabelText('Longitude')).toHaveValue(79.88);
});
