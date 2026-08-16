/**
 * Budgets page — the proving ground for the shared page smoke bar.
 *
 * The bar, applied identically to every page:
 *   1. mount at the real route, handlers resolving asynchronously
 *   2. assert the LOADING state is genuinely visible first
 *   3. await a LOADED SENTINEL — a string that only appears once fixture data lands —
 *      and assert the loading text is gone. NOT the <h1>: most pages render their h1
 *      unconditionally above the loading switch (here: h1 at Budgets.tsx:88, loading at
 *      :142), so awaiting the heading resolves while still loading and asserts nothing.
 *   4. assert one exact Indian-formatted money string
 *   5. zero console.error (React reports hook-order and update-during-render this way,
 *      without throwing)
 *   6. one interaction, and one all-500 case asserting the error TOAST — because a
 *      failed load renders "No budgets set up yet", byte-identical to the empty state
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import BudgetsPage from '@/pages/budgets/Budgets';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { BUDGETS_VS_ACTUALS, MONEY_FORMATTED, MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

const budgetHandlers = (data: unknown = BUDGETS_VS_ACTUALS) => [
  http.get(url('/budgets/vs-actuals'), () => HttpResponse.json({ data })),
];

describe('Budgets page — smoke', () => {
  it('shows loading, then renders budget data (the loading->loaded transition)', async () => {
    renderPage(<BudgetsPage />, { route: '/budgets', handlers: budgetHandlers() });

    // Leg 2: loading is genuinely the first paint.
    expect(screen.getByText(/Loading budgets/i)).toBeInTheDocument();

    // Leg 3: the sentinel only exists once data lands.
    expect(await screen.findByText('Food')).toBeInTheDocument();
    expect(screen.queryByText(/Loading budgets/i)).toBeNull();

    // Leg 4: exact Indian formatting, lakh grouping included. getAllBy — the card shows
    // the budgeted amount in more than one place; the assertion is about the FORMAT.
    expect(screen.getAllByText(MONEY_FORMATTED).length).toBeGreaterThan(0);
  });

  it('renders the page heading', async () => {
    renderPage(<BudgetsPage />, { route: '/budgets', handlers: budgetHandlers() });
    expect(
      await screen.findByRole('heading', { level: 1, name: /budgets/i }),
    ).toBeInTheDocument();
  });

  it('renders the empty state when there are no budgets', async () => {
    renderPage(<BudgetsPage />, { route: '/budgets', handlers: budgetHandlers([]) });
    expect(await screen.findByText(/No budgets set up yet/i)).toBeInTheDocument();
  });

  it('a MEMBER can open the add-budget form', async () => {
    // MEMBER, not ADMIN: the create button is gated on !isViewingFamilyWide
    // (Budgets.tsx:116) and an ADMIN with no selected member IS viewing family-wide,
    // so the button is correctly absent for them.
    const user = userEvent.setup();
    renderPage(<BudgetsPage />, {
      route: '/budgets', handlers: budgetHandlers(), user: MEMBER_USER,
    });
    await screen.findByText('Food');

    await user.click(await screen.findByRole('button', { name: /add budget/i }));

    expect(await screen.findByText(/Amount/i)).toBeInTheDocument();
  });

  it('an ADMIN viewing family-wide gets no create button', async () => {
    renderPage(<BudgetsPage />, { route: '/budgets', handlers: budgetHandlers() });
    await screen.findByText('Food');
    expect(screen.queryByRole('button', { name: /add budget/i })).toBeNull();
  });

  it('surfaces an error toast when the budgets request fails', async () => {
    renderPage(<BudgetsPage />, {
      route: '/budgets',
      handlers: [
        http.get(url('/budgets/vs-actuals'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });

    // The page itself renders the empty state on failure — indistinguishable from
    // "no budgets". The toast is the only signal that anything went wrong, so that is
    // what this asserts. It also covers lib/api.ts's api:error dispatch.
    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
  });
});
