import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import i18n from '../i18n';
import { AuthPage } from '../CitizenPages';

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock('../auth', async (original) => ({
  ...(await original<typeof import('../auth')>()),
  useAuth: () => ({ signIn }),
}));
vi.mock('../MapView', () => ({ MapView: () => null }));
beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  void i18n.changeLanguage('en');
});

it('explains sign-in throttling separately from incorrect credentials', async () => {
  signIn.mockRejectedValue({ isAxiosError: true, response: { status: 429 } });
  render(
    <MemoryRouter>
      <AuthPage />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'citizen@example.test' },
  });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'SyntheticPassword!9' } });
  fireEvent.click(screen.getByRole('button', { name: /^Log in$/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Too many sign-in attempts. Please wait a minute, then try again.',
  );
  expect(screen.getByRole('button', { name: /^Log in$/ })).toBeEnabled();
});
