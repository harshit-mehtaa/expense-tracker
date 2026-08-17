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
    // Wait for the ADMIN state to exist before asserting a negative: the member selector
    // renders only once auth resolves as ADMIN. Without it this races the session restore
    // and passes for the wrong reason (proved by delaying /auth/me).
    await screen.findByLabelText(/View:/i);
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

// ─── Which side of zero a card balance sits on ───────────────────────────────

/**
 * A credit card's balance is negative when you owe. The form used to infer that from the
 * sign already stored: if a card held a positive number it was treated as a credit
 * balance and kept positive on every subsequent save. So a card recording what was
 * actually owed could never be corrected through the UI, and stayed on the asset side —
 * overstating net worth by twice the amount. One real card was wrong this way.
 */
describe('Accounts page — credit card balance sign', () => {
  const OWED_CARD = {
    id: 'card-1',
    bankName: 'HDFC Bank',
    accountType: 'CREDIT_CARD',
    accountNumberLast4: '7740',
    currentBalance: 6547,      // wrongly positive: this is what is owed
    isActive: true,
  };

  const openCardEditor = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText(/HDFC Bank/);
    const editButtons = await screen.findAllByRole('button', { name: /edit/i });
    await user.click(editButtons[0]);
  };

  it('lets a wrongly-signed card be corrected to what is owed', async () => {
    const user = userEvent.setup();
    let body: any;
    renderPage(<AccountsPage />, {
      route: '/accounts',
      user: MEMBER_USER,
      handlers: [
        http.get(url('/accounts'), () => HttpResponse.json({ data: [OWED_CARD] })),
        http.put(url('/accounts/card-1'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: OWED_CARD });
        }),
      ],
    });

    await openCardEditor(user);

    // Opening the form reflects what is stored: currently flagged as a credit balance.
    const creditToggle = await screen.findByLabelText(/credit balance, not an amount owed/i);
    expect(creditToggle).toBeChecked();

    // Say it is actually owed — previously impossible.
    await user.click(creditToggle);
    await user.click(screen.getByRole('button', { name: /save|update/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body.currentBalance).toBe(-6547);
  });

  it('keeps a genuine credit balance positive when the user says so', async () => {
    const user = userEvent.setup();
    let body: any;
    renderPage(<AccountsPage />, {
      route: '/accounts',
      user: MEMBER_USER,
      handlers: [
        http.get(url('/accounts'), () => HttpResponse.json({ data: [OWED_CARD] })),
        http.put(url('/accounts/card-1'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: OWED_CARD });
        }),
      ],
    });

    await openCardEditor(user);
    expect(await screen.findByLabelText(/credit balance, not an amount owed/i)).toBeChecked();
    await user.click(screen.getByRole('button', { name: /save|update/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body.currentBalance).toBe(6547);
  });
});
