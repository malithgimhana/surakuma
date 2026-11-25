import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CaseCommunicationPanel } from '../CaseCommunicationPanel';
import '../i18n';

const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ get: calls.get, api: { post: calls.post } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('shows provenance and requires explicit review before sending a localized draft', async () => {
  const path = '/requests/case-one/communications';
  let publishedAt: string | null = null;
  calls.get.mockImplementation(async (route: string) => route === '/countries'
    ? [{ code: 'NP', languages: 'en,ne' }]
    : [{ draft: { id: 'draft-one', language: 'ne', audience: 'Citizen', source: 'OpenAI · gpt-6-luna', publishedAt },
      preview: 'SK-DEMO: अनुरोध प्राप्त भयो। कृपया आफ्नो अनुरोध हेर्नुहोस्।' }]);
  calls.post.mockImplementation(async () => { publishedAt = '2026-11-19T10:00:00Z'; });
  const { container } = render(<QueryClientProvider client={new QueryClient()}>
    <CaseCommunicationPanel requestId="case-one" country="NP" />
  </QueryClientProvider>);
  const section = container.querySelector('details')!;
  section.open = true;
  fireEvent(section, new Event('toggle'));
  expect(await screen.findByText(/OpenAI · gpt-6-luna/)).toBeInTheDocument();
  expect(screen.getByText(/SK-DEMO/)).toHaveAttribute('lang', 'ne');
  const send = screen.getByRole('button', { name: 'Send reviewed update' });
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /verified this wording/ }));
  fireEvent.click(send);
  await waitFor(() => expect(calls.post).toHaveBeenCalledWith(path + '/draft-one/publish', { wordingReviewed: true }));
  expect(await screen.findByText('Published')).toBeInTheDocument();
});
