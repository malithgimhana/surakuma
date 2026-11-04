import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../i18n';
import { get } from '../api';
import { SystemReadiness } from '../SystemReadiness';

vi.mock('../api', () => ({ get: vi.fn(), errorMessage: () => 'Service unavailable' }));
beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderStatus() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SystemReadiness />
    </QueryClientProvider>,
  );
}

it('explains fallback and captured notifications without claiming live delivery', async () => {
  vi.mocked(get).mockResolvedValue({
    demonstrationMode: true,
    checkedAt: '2026-10-21T10:00:00Z',
    integrations: [
      {
        id: 'ai',
        name: 'AI recommendations',
        mode: 'Deterministic fallback',
        state: 'Fallback',
        detail: 'Development rules are active.',
        missingSettings: ['Ai__ApiKey'],
      },
    ],
    notificationQueue: [
      { state: 'Captured', count: 3 },
      { state: 'Review', count: 1 },
    ],
  });
  renderStatus();
  const ai = await screen.findByRole('region', { name: 'AI recommendations' });
  expect(within(ai).getByText('Fallback')).toBeVisible();
  expect(within(ai).getByText('Ai__ApiKey')).toBeVisible();
  expect(screen.getByText(/Captured means saved locally/)).toBeVisible();
  expect(screen.getByText(/configured service still needs a successful live test/)).toBeVisible();
  expect(get).toHaveBeenCalledWith('/admin/system');
});

it('lets an administrator retry a failed status check', async () => {
  vi.mocked(get)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({
      demonstrationMode: true,
      checkedAt: '2026-10-21T10:00:00Z',
      integrations: [],
      notificationQueue: [],
    });
  renderStatus();
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('No notification events yet.')).toBeVisible();
  expect(get).toHaveBeenCalledTimes(2);
});
