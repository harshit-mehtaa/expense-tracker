/**
 * Settings page — smoke.
 *
 * Bar deviations, documented:
 *   - Leg 2 (loading affordance) does not apply: the page shell renders synchronously
 *     from AuthContext, and ExchangeRateSettings defaults `rates` to `[]`, so there is
 *     no loading UI at all. Leg 3's sentinel (a rendered rate row) still proves the
 *     fetch resolved.
 *   - Leg 4 (money) does not apply: exchange rates render as bare numbers in inputs,
 *     not INR-formatted currency.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import SettingsPage from '@/pages/Settings';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { ADMIN_USER } from '../support/fixtures';

failOnConsoleError();

const RATES = [
  { fromCurrency: 'USD', rate: 83.25, updatedAt: '2025-04-01T00:00:00.000Z' },
  { fromCurrency: 'EUR', rate: 90.1, updatedAt: '2025-04-01T00:00:00.000Z' },
];

const rateHandlers = (rates: unknown[] = RATES) => [
  http.get(url('/investments/exchange-rates'), () => HttpResponse.json({ data: rates })),
];

describe('Settings page — smoke', () => {
  it('renders the profile prefilled from the session, then the fetched rates', async () => {
    renderPage(<SettingsPage />, { route: '/settings', handlers: rateHandlers() });

    // Profile comes from AuthContext, so it lands with the session.
    expect(await screen.findByDisplayValue(ADMIN_USER.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(ADMIN_USER.email)).toBeInTheDocument();

    // Leg 3: the rate rows only exist once the exchange-rate query resolves.
    expect(await screen.findByText('USD/INR')).toBeInTheDocument();
    expect(screen.getByText('EUR/INR')).toBeInTheDocument();
    expect(screen.getByDisplayValue('83.25')).toBeInTheDocument();
  });

  it('renders the page heading', async () => {
    renderPage(<SettingsPage />, { route: '/settings', handlers: rateHandlers() });
    expect(
      await screen.findByRole('heading', { level: 1, name: /settings/i }),
    ).toBeInTheDocument();
  });

  it('shows the signed-in role', async () => {
    renderPage(<SettingsPage />, { route: '/settings', handlers: rateHandlers() });
    expect(await screen.findByText(ADMIN_USER.role)).toBeInTheDocument();
  });

  it('saves the profile', async () => {
    const user = userEvent.setup();
    let body: unknown;
    renderPage(<SettingsPage />, {
      route: '/settings',
      handlers: [
        ...rateHandlers(),
        http.put(url(`/admin/users/${ADMIN_USER.id}`), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: ADMIN_USER });
        }),
      ],
    });

    const name = await screen.findByDisplayValue(ADMIN_USER.name);
    await user.clear(name);
    await user.type(name, 'Asha Mehta');
    await user.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => {
      expect(body).toEqual({ name: 'Asha Mehta', email: ADMIN_USER.email });
    });
  });

  it('changes the password and confirms success inline', async () => {
    const user = userEvent.setup();
    renderPage(<SettingsPage />, {
      route: '/settings',
      handlers: [
        ...rateHandlers(),
        http.post(url('/auth/change-password'), () => HttpResponse.json({ data: { ok: true } })),
      ],
    });
    await screen.findByText('USD/INR');

    const passwords = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
    await user.type(passwords[0], 'OldPass@1');
    await user.type(passwords[1], 'NewPass@1');
    await user.click(screen.getByRole('button', { name: /^change password$/i }));

    expect(await screen.findByText(/Password changed successfully/i)).toBeInTheDocument();
  });

  it('rejects a weak new password before submitting', async () => {
    const user = userEvent.setup();
    renderPage(<SettingsPage />, { route: '/settings', handlers: rateHandlers() });
    await screen.findByText('USD/INR');

    const passwords = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
    await user.type(passwords[0], 'OldPass@1');
    await user.type(passwords[1], 'weak');
    await user.click(screen.getByRole('button', { name: /^change password$/i }));

    await waitFor(() => {
      const inline = [...document.querySelectorAll('p.text-destructive')].map((e) => e.textContent ?? '');
      expect(inline.some((t) => t.length > 0)).toBe(true);
    });
  });

  it('updates an exchange rate with the edited value', async () => {
    const user = userEvent.setup();
    let putUrl: string | undefined;
    let body: unknown;
    renderPage(<SettingsPage />, {
      route: '/settings',
      handlers: [
        ...rateHandlers(),
        http.put(url('/investments/exchange-rates/:currency'), async ({ request }) => {
          putUrl = request.url;
          body = await request.json();
          return HttpResponse.json({ data: {} });
        }),
      ],
    });
    await screen.findByText('USD/INR');

    const usdInput = screen.getByDisplayValue('83.25');
    await user.clear(usdInput);
    await user.type(usdInput, '84.5');
    // The refresh buttons are icon-only; the first belongs to the USD row.
    await user.click(screen.getAllByRole('button', { name: '' })[0]);

    await waitFor(() => {
      expect(putUrl).toContain('/investments/exchange-rates/USD');
      expect(body).toEqual({ rate: 84.5 });
    });
  });

  it('renders no rate rows when the exchange-rate request fails', async () => {
    renderPage(<SettingsPage />, {
      route: '/settings',
      handlers: [
        http.get(url('/investments/exchange-rates'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });

    // Failure is silent in this section — `rates` stays []. The toast is the only signal.
    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('USD/INR')).toBeNull();
  });
});
