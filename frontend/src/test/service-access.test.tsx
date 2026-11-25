import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '../i18n';
import { api } from '../api';
import { CitizenTriageCard } from '../CitizenTriageCard';
import type { AiDetail, RequestDetail } from '../types';

vi.mock('../api', () => ({ api: { post: vi.fn() }, errorMessage: () => 'Unavailable' }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('requires a reason and records a priority override against the current assessment', async () => {
  const detail = {
    request: { id: 'request-1', category: 'Medical', priority: 'High', description: 'Synthetic request' },
    history: [],
  } as unknown as RequestDetail;
  const advice: AiDetail = {
    recommendations: [{
      id: 'assessment-1', requestId: 'request-1', category: 'Medical', priority: 'High',
      explanation: 'Review the reported need.', provider: 'OpenAI', model: 'Test model',
      confidence: null, confidenceKind: 'Unavailable', reviewState: 'Pending',
      fallback: false, createdAt: '2026-11-24T08:00:00Z', updatedAt: '2026-11-24T08:00:00Z',
    }],
    decisions: [], duplicates: [],
  };
  vi.mocked(api.post).mockResolvedValue({});
  render(<QueryClientProvider client={new QueryClient()}>
    <CitizenTriageCard detail={detail} advice={advice} canReview />
  </QueryClientProvider>);
  expect(screen.getByText('Confidence unavailable')).toBeVisible();
  const modify = screen.getByRole('button', { name: 'Modify assessment' }) as HTMLButtonElement;
  expect(modify.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Final priority for modification'), { target: { value: 'Urgent' } });
  fireEvent.change(screen.getByLabelText('Review reason'), { target: { value: 'Timing verified by staff' } });
  fireEvent.click(modify);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/requests/request-1/decisions', {
    recommendationId: 'assessment-1', action: 'Modify', reason: 'Timing verified by staff', finalPriority: 'Urgent',
  }));
});
