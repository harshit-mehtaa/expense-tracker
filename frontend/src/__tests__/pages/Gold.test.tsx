/**
 * Gold page — smoke.
 *
 * Bar deviation, documented: Gold has NO loading affordance. `gold` defaults to `[]`,
 * so while the query is in flight the page renders "No gold holdings added yet" —
 * byte-identical to a genuinely empty account, and identical again to a failed load.
 * Leg 2 therefore asserts that empty-looking first paint rather than a spinner, and
 * leg 3 waits on a data sentinel to prove the transition actually happened.
 * That indistinguishability is a real UX gap, flagged not fixed.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import GoldPage from '@/pages/investments/Gold';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MONEY_FORMATTED, MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

const HOLDING = {
  id: 'g-1',
  type: 'PHYSICAL',
  description: 'Wedding bangles',
  quantityGrams: 20,
  purchasePricePerGram: 5000,
  currentPricePerGram: 6250, // 20 * 6250 = 125000 -> ₹1,25,000.00
  purchaseDate: '2024-05-01T00:00:00.000Z',
  notes: 'Locker A',
  userName: 'Asha',
};

const SUMMARY = {
  totalGrams: 20,
  totalCurrentValue: 125000,
  totalPurchaseValue: 100000,
  gain: 25000,
  gainPct: 25,
};

const goldHandlers = (
  holdings: unknown[] = [HOLDING],
  summary: unknown = SUMMARY,
) => [
  http.get(url('/investments/gold'), () => HttpResponse.json({ data: { holdings, summary } })),
];

describe('Gold page — smoke', () => {
  it('transitions from the empty first paint to rendered holdings', async () => {
    renderPage(<GoldPage />, { route: '/gold', handlers: goldHandlers() });

    // Leg 2: no spinner exists; the in-flight paint is the empty state.
    expect(screen.getByText(/No gold holdings added yet/i)).toBeInTheDocument();

    // Leg 3: the sentinel only exists once data lands, and the empty state is gone.
    expect(await screen.findByText('Wedding bangles')).toBeInTheDocument();
    expect(screen.queryByText(/No gold holdings added yet/i)).toBeNull();

    // Leg 4: 20g * ₹6,250/g = ₹1,25,000.00, exact lakh grouping.
    expect(screen.getAllByText(MONEY_FORMATTED).length).toBeGreaterThan(0);
  });

  it('renders the page heading', async () => {
    renderPage(<GoldPage />, { route: '/gold', handlers: goldHandlers() });
    expect(
      await screen.findByRole('heading', { level: 1, name: /gold holdings/i }),
    ).toBeInTheDocument();
  });

  it('renders the summary tiles from the API summary', async () => {
    renderPage(<GoldPage />, { route: '/gold', handlers: goldHandlers() });
    await screen.findByText('Wedding bangles');

    expect(screen.getByText('20.00g')).toBeInTheDocument();
    expect(screen.getByText('25.00%')).toBeInTheDocument();
  });

  it('keeps the empty state when the account genuinely has no gold', async () => {
    renderPage(<GoldPage />, { route: '/gold', handlers: goldHandlers([], null) });
    await waitFor(() => {
      expect(screen.getByText(/No gold holdings added yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('Wedding bangles')).toBeNull();
  });

  it('a MEMBER can open the add-holding form', async () => {
    // MEMBER rather than ADMIN: create controls are gated on !isViewingFamilyWide, and an
    // ADMIN with no member selected IS family-wide.
    const user = userEvent.setup();
    renderPage(<GoldPage />, { route: '/gold', handlers: goldHandlers(), user: MEMBER_USER });
    await screen.findByText('Wedding bangles');

    await user.click(await screen.findByRole('button', { name: /add gold/i }));

    expect(await screen.findByRole('heading', { name: /add gold holding/i })).toBeInTheDocument();
  });

  it('surfaces an error toast when the gold request fails', async () => {
    renderPage(<GoldPage />, {
      route: '/gold',
      handlers: [
        http.get(url('/investments/gold'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });

    // The page renders the empty state on failure, indistinguishable from "no gold".
    // The toast is the only real signal, so that is what this asserts.
    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
  });
});
