import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../i18n';
import { api, get } from '../api';
import { OrganisationsPage } from '../OrganisationsPage';

vi.mock('../auth', () => ({
  useOptionalAuth: () => ({
    user: { memberships: [{ role: 'CountryAdministrator', countryCode: 'LK' }] },
  }),
}));
vi.mock('../api', () => ({ get: vi.fn(), api: { delete: vi.fn(), post: vi.fn() }, errorMessage: () => 'Service error' }));

HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
HTMLDialogElement.prototype.close ??= function () { this.open = false; };

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

function openDirectory(globalAdmin: boolean, blockers: string[] = []) {
  let organisations = [{ id: 'test-org', name: 'Test Relief Centre', enabled: true, primaryCrises: [] }];
  vi.mocked(get).mockImplementation(async <T,>(path: string) => {
    if (path.endsWith('/deletion')) return { countries: path.includes('/countries/LK') ? ['Sri Lanka'] : ['Nepal', 'Sri Lanka'], blockers } as T;
    if (path.startsWith('/admin/organisations?')) return organisations as T;
    return [{ code: 'LK', name: 'Sri Lanka', languages: 'en' }] as T;
  });
  vi.mocked(api.delete).mockImplementation(async () => {
    organisations = [];
  });
  vi.mocked(api.post).mockImplementation(async () => {
    const partner = { id: 'new-org', name: 'Sri Lanka Relief Network', enabled: true, primaryCrises: [] };
    organisations.push(partner);
    return { data: partner };
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin?section=organisations']}>
        <OrganisationsPage globalAdmin={globalAdmin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('previews the countries and deletes only after confirmation', async () => {
  openDirectory(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete organisation' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Delete organisation?' }));
  expect(await dialog.findByText(/Nepal, Sri Lanka/)).toBeVisible();
  expect(api.delete).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(api.delete).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Delete organisation' }));
  const reopened = within(screen.getByRole('dialog', { name: 'Delete organisation?' }));
  const confirm = reopened.getByRole('button', { name: 'Delete organisation' });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  expect(await screen.findByText('“Test Relief Centre” was deleted.')).toBeVisible();
  expect(screen.queryByRole('button', { name: /Test Relief Centre/ })).not.toBeInTheDocument();
  expect(api.delete).toHaveBeenCalledExactlyOnceWith('/admin/organisations/test-org');
});

it('offers archiving for linked records and sends the archive request on confirmation', async () => {
  const blocker = 'This organisation has assigned or shared cases.';
  openDirectory(true, [blocker]);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete organisation' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Delete organisation?' }));
  expect(await dialog.findByText(blocker)).toBeVisible();
  expect(dialog.getByText(/Open cases return to the unassigned queue/)).toBeVisible();
  expect(api.delete).not.toHaveBeenCalled();
  const confirm = dialog.getByRole('button', { name: 'Archive organisation' });
  fireEvent.click(confirm);
  expect(await screen.findByText('“Test Relief Centre” was archived in all countries.')).toBeVisible();
  expect(api.delete).toHaveBeenCalledExactlyOnceWith('/admin/organisations/test-org?archiveLinked=true');
});

it('lets a country administrator remove a registration from the managed country', async () => {
  openDirectory(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove from Sri Lanka' }));
  expect(screen.queryByRole('button', { name: 'Delete organisation' })).not.toBeInTheDocument();
  const dialog = within(screen.getByRole('dialog', { name: 'Remove from Sri Lanka?' }));
  expect(await dialog.findByText(/open cases return to the unassigned queue in Sri Lanka/)).toBeVisible();
  expect(api.delete).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: 'Remove from Sri Lanka' }));
  expect(await screen.findByText('“Test Relief Centre” was removed from Sri Lanka.')).toBeVisible();
  expect(api.delete).toHaveBeenCalledExactlyOnceWith('/admin/organisations/test-org/countries/LK');
});

it.each([
  { role: 'country administrator', globalAdmin: false },
  { role: 'system administrator', globalAdmin: true },
])('lets a $role add a partner directly in the current country', async ({ globalAdmin }) => {
  openDirectory(globalAdmin);
  fireEvent.click(screen.getByRole('button', { name: 'Add organisation' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Add organisation' }));
  expect(dialog.getByText('Sri Lanka', { exact: true })).toBeVisible();
  expect(dialog.queryByLabelText('Organisation setup')).not.toBeInTheDocument();
  expect(dialog.queryByLabelText('Organisation ID')).not.toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText('Organisation name'), { target: { value: 'Sri Lanka Relief Network' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Create organisation' }));
  expect(await screen.findByText('Sri Lanka Relief Network was added in Sri Lanka and is pending verification.')).toBeVisible();
  expect(await screen.findByRole('button', { name: /Sri Lanka Relief Network.*Pending verification/ })).toBeVisible();
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/admin/organisations', { name: 'Sri Lanka Relief Network', countryCode: 'LK' });
});
