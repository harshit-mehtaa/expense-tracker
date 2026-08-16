/**
 * Accounts page — smoke.
 *
 * Two behaviours worth knowing before reading the assertions:
 *  - The <h1> is at :661 and the loading switch at :738, so awaiting the heading would
 *    resolve mid-load. The loaded sentinel is the bank name from the fixture.
 *  - `maskedBalances` defaults to TRUE (:204), so balances render as `₹ ••••••` until
 *    the "Show Balances" toggle is clicked. The money-format leg therefore has to
 *    unmask first — asserting ₹1,25,000.00 on first paint would fail for a real reason.
 *
 * Handler count: 1 page-specific (/accounts, already in base) + 5 base.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import AccountsPage from '@/pages/accounts/Accounts';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { ACCOUNTS, MONEY_FORMATTED, MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

const accountHandlers = (data: unknown = ACCOUNTS) => [
  http.get(url('/accounts'), () => HttpResponse.json({ data })),
];

describe('Accounts page — smoke', () => {
  it('shows loading, then renders account data (the loading->loaded transition)', async () => {
    renderPage(<AccountsPage />, { route: '/accounts', handlers: accountHandlers() });

    expect(screen.getByText(/Loading accounts/i)).toBeInTheDocument();

    expect(await screen.findByText(/HDFC Bank/)).toBeInTheDocument();
    expect(screen.queryByText(/Loading accounts/i)).toBeNull();
  });

  it('renders the page heading', async () => {
    renderPage(<AccountsPage />, { route: '/accounts', handlers: accountHandlers() });
    expect(
      await screen.findByRole('heading', { level: 1, name: /accounts & cards/i }),
    ).toBeInTheDocument();
  });

  it('masks balances by default and reveals Indian-formatted money on toggle', async () => {
    const user = userEvent.setup();
    renderPage(<AccountsPage />, { route: '/accounts', handlers: accountHandlers() });
    await screen.findByText(/HDFC Bank/);

    // Masked on first paint — this is the default, not a bug.
    expect(screen.getAllByText('₹ ••••••').length).toBeGreaterThan(0);
    expect(screen.queryByText(MONEY_FORMATTED)).toBeNull();

    await user.click(screen.getByRole('button', { name: /show balances/i }));

    expect(screen.getAllByText(MONEY_FORMATTED).length).toBeGreaterThan(0);
  });

  it('renders the empty state when there are no accounts', async () => {
    renderPage(<AccountsPage />, { route: '/accounts', handlers: accountHandlers([]) });
    expect(await screen.findByText(/No accounts added yet/i)).toBeInTheDocument();
  });

  it('an ADMIN viewing family-wide gets no create button', async () => {
    // Same gate as Budgets: create is hidden while !isViewingFamilyWide is false (:691).
    renderPage(<AccountsPage />, { route: '/accounts', handlers: accountHandlers() });
    await screen.findByText(/HDFC Bank/);
    expect(screen.queryByRole('button', { name: /add bank account/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add card/i })).toBeNull();
  });

  it('a MEMBER gets the create button', async () => {
    renderPage(<AccountsPage />, {
      route: '/accounts', handlers: accountHandlers(), user: MEMBER_USER,
    });
    await screen.findByText(/HDFC Bank/);
    expect(await screen.findByRole('button', { name: /add bank account/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add card/i })).toBeInTheDocument();
  });

  it('surfaces an error toast when the accounts request fails', async () => {
    renderPage(<AccountsPage />, {
      route: '/accounts',
      handlers: [
        http.get(url('/accounts'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
  });
});
