import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../i18n';
import i18n from '../i18n';
import { Badge, ErrorState } from '../components';
import { NewRequest } from '../CitizenPages';
vi.mock('../auth', () => ({
  useAuth: () => ({ user: { id: 'test', householdSize: 4, accessibilityNeeds: '' } }),
}));
vi.mock('../MapView', () => ({ MapView: () => null }));
vi.mock('../api', () => ({
  get: vi.fn().mockResolvedValue({
    crises: [{ id: 'crisis', name: 'Demo flood' }],
    organisations: [{ id: 'org', name: 'Demo organisation' }],
  }),
  api: { post: vi.fn() },
  errorMessage: () => 'Technical service failure',
}));
beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  void i18n.changeLanguage('en');
});
describe('Citizen accessibility and workflows', () => {
  it('communicates status in text and provides a retry action', () => {
    const retry = vi.fn();
    render(
      <>
        <Badge value="PartiallyFulfilled" />
        <ErrorState error={new Error('offline')} retry={retry} />
      </>,
    );
    expect(screen.getByText('Partially delivered')).toBeVisible();
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('Describe what you need');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(
        screen.getAllByText('Please complete the required fields correctly.').length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getByLabelText('Describe what you need')).toBeVisible();
    expect(sessionStorage.getItem('surakuma.draft.test')).toContain('FoodWater');
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
