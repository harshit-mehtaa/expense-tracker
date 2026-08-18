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

// ─── Recording a sale ────────────────────────────────────────────────────────

/**
 * Kept alongside the EXISTING destructive delete button, deliberately — they mean
 * different things. Delete is "this shouldn\'t exist" (a mistake); Sell is "I actually
 * owned this and got rid of it" (a real event worth a permanent record).
 */
describe('Gold page — recording a sale', () => {
  it('opens a sale confirmation, and delete still works alongside it', async () => {
    const user = userEvent.setup();
    renderPage(<GoldPage />, { route: '/gold', handlers: goldHandlers(), user: MEMBER_USER });
    await screen.findByText('Wedding bangles');

    expect(screen.getByRole('button', { name: /^sell$/i })).toBeInTheDocument();
    // The pre-existing delete icon button is still there, unchanged.
    expect(screen.getByTitle(/delete/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^sell$/i }));
    expect(await screen.findByText(/record sale — wedding bangles/i)).toBeInTheDocument();
  });

  it('sends the sale price and date, and confirms with a success toast', async () => {
    const user = userEvent.setup();
    let body: any;
    renderPage(<GoldPage />, {
      route: '/gold',
      user: MEMBER_USER,
      handlers: [
        ...goldHandlers(),
        http.post(url('/investments/gold/g-1/sell'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: { ...HOLDING, soldAt: '2026-06-01T00:00:00.000Z', salePrice: 130000 } });
        }),
      ],
    });
    await screen.findByText('Wedding bangles');
    await user.click(screen.getByRole('button', { name: /^sell$/i }));

    const priceInput = await screen.findByLabelText(/sale price/i);
    await user.clear(priceInput);
    await user.type(priceInput, '130000');
    await user.click(screen.getByRole('button', { name: /confirm sale/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ salePrice: 130000 });
    await waitFor(() => {
      expect(screen.getByText(/sale recorded/i)).toBeInTheDocument();
    });
  });

  it('surfaces the loan-collateral guard as a toast — gold DOES secure loans', async () => {
    const user = userEvent.setup();
    renderPage(<GoldPage />, {
      route: '/gold',
      user: MEMBER_USER,
      handlers: [
        ...goldHandlers(),
        http.post(url('/investments/gold/g-1/sell'), () => HttpResponse.json(
          { message: 'This still secures an active loan (Muthoot Finance).' },
          { status: 409 },
        )),
      ],
    });
    await screen.findByText('Wedding bangles');
    await user.click(screen.getByRole('button', { name: /^sell$/i }));
    await user.click(screen.getByRole('button', { name: /confirm sale/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/active loan/i).length).toBeGreaterThan(0);
    });
  });

  it('hides Sell and shows Sale Price instead of Current Rate once sold', async () => {
    const SOLD = { ...HOLDING, soldAt: '2026-06-01T00:00:00.000Z', salePrice: 130000 };
    renderPage(<GoldPage />, { route: '/gold', user: MEMBER_USER, handlers: goldHandlers([SOLD]) });
    await screen.findByText('Wedding bangles');

    expect(screen.queryByRole('button', { name: /^sell$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/sale price/i)).toBeInTheDocument();
    expect(screen.queryByText('Current Rate')).not.toBeInTheDocument();
    // Delete remains available even once sold — a data-entry mistake can still be undone.
    expect(screen.getByTitle(/delete/i)).toBeInTheDocument();
  });
});
