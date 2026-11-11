import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegionField } from '../geography';

vi.mock('../api', () => ({
  get: vi.fn().mockResolvedValue([
    { id: 'province', name: 'Bagmati', levelName: 'Province', parentId: null },
    { id: 'district', name: 'Kathmandu', levelName: 'District', parentId: 'province' },
    { id: 'city', name: 'Kathmandu city', levelName: 'Municipality', parentId: 'district' },
    { id: 'other', name: 'Koshi', levelName: 'Province', parentId: null },
  ]),
}));
afterEach(cleanup);

it('restores the existing regional hierarchy and discards descendants when the parent changes', async () => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <form>
        <RegionField initialDivisionId="city" />
      </form>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Administrative region')).toHaveValue('province'),
  );
  expect(screen.getByLabelText('Local division (level 2)')).toHaveValue('district');
  expect(screen.getByLabelText('Local division (level 3)')).toHaveValue('city');
  expect(new FormData(container.querySelector('form')!).get('administrativeDivisionId')).toBe(
    'city',
  );
  fireEvent.change(screen.getByLabelText('Administrative region'), { target: { value: 'other' } });
  expect(screen.queryByLabelText('Local division (level 3)')).not.toBeInTheDocument();
  expect(new FormData(container.querySelector('form')!).get('administrativeDivisionId')).toBe(
    'other',
  );
});
