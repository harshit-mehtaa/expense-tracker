/**
 * Real Estate page — smoke.
 *
 * Bar deviation, documented: like Gold, this page has NO loading affordance.
 * `properties` defaults to `[]`, so the in-flight paint is "No properties added yet",
 * identical to a genuinely empty portfolio and identical again to a failed load.
 * Leg 2 asserts that empty-looking first paint; leg 3 proves the transition with a
 * data sentinel. The indistinguishability is a real UX gap, flagged not fixed.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import RealEstatePage from '@/pages/investments/RealEstate';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MONEY_FORMATTED, MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

const PROPERTY = {
  id: 're-1',
  propertyName: 'Koramangala Flat',
  location: 'Bengaluru',
  propertyType: 'RESIDENTIAL',
  purchasePrice: 5000000,
  currentValue: 8000000,
  purchaseDate: '2020-06-01T00:00:00.000Z',
  rentalIncomeMonthly: 125000, // -> ₹1,25,000.00
  currentValueShare: 8000000,
  userName: 'Asha',
  owners: [{ userId: 'u-admin', userName: 'Asha', sharePercent: 100 }],
};

const SUMMARY = {
  totalCurrent: 8000000,
  totalPurchase: 5000000,
  unrealisedGain: 3000000,
  totalMonthlyRental: 125000,
};

const reHandlers = (properties: unknown[] = [PROPERTY], summary: unknown = SUMMARY) => [
  http.get(url('/investments/real-estate'), () =>
    HttpResponse.json({ data: { properties, summary } })),
];

describe('Real Estate page — smoke', () => {
  it('transitions from the empty first paint to rendered properties', async () => {
    renderPage(<RealEstatePage />, { route: '/real-estate', handlers: reHandlers() });

    // Leg 2: no spinner exists; the in-flight paint is the empty state.
    expect(screen.getByText(/No properties added yet/i)).toBeInTheDocument();

    // Leg 3: sentinel appears only once data lands; empty state is gone.
    expect(await screen.findByText('Koramangala Flat')).toBeInTheDocument();
    expect(screen.queryByText(/No properties added yet/i)).toBeNull();

    // Leg 4: monthly rental renders with exact lakh grouping.
    expect(screen.getAllByText(MONEY_FORMATTED).length).toBeGreaterThan(0);
  });

  it('renders the page heading', async () => {
    renderPage(<RealEstatePage />, { route: '/real-estate', handlers: reHandlers() });
    expect(
      await screen.findByRole('heading', { level: 1, name: /real estate/i }),
    ).toBeInTheDocument();
  });

  it('renders the property location and count', async () => {
    renderPage(<RealEstatePage />, { route: '/real-estate', handlers: reHandlers() });
    await screen.findByText('Koramangala Flat');

    expect(screen.getByText('Bengaluru')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders the owner split', async () => {
    renderPage(<RealEstatePage />, { route: '/real-estate', handlers: reHandlers() });
    await screen.findByText('Koramangala Flat');
    // getAllBy: "Owners" appears both as the card's section label and in the add-property
    // form's field label, so an exact-one query is wrong here.
    expect(screen.getAllByText(/Owners/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it('keeps the empty state when there are genuinely no properties', async () => {
    renderPage(<RealEstatePage />, {
      route: '/real-estate',
      handlers: reHandlers([], { totalCurrent: 0, totalPurchase: 0, unrealisedGain: 0, totalMonthlyRental: 0 }),
    });
    await waitFor(() => {
      expect(screen.getByText(/No properties added yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('Koramangala Flat')).toBeNull();
  });

  it('a MEMBER can open the add-property form', async () => {
    const user = userEvent.setup();
    renderPage(<RealEstatePage />, {
      route: '/real-estate', handlers: reHandlers(), user: MEMBER_USER,
    });
    await screen.findByText('Koramangala Flat');

    await user.click(await screen.findByRole('button', { name: /add property/i }));

    expect(await screen.findByRole('heading', { name: /add property/i })).toBeInTheDocument();
  });

  it('surfaces an error toast when the real-estate request fails', async () => {
    renderPage(<RealEstatePage />, {
      route: '/real-estate',
      handlers: [
        http.get(url('/investments/real-estate'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
  });
});

// ─── Recording a sale ────────────────────────────────────────────────────────

/**
 * There was no delete action on this page at all before this — "Sell" is the property's
 * first and only lifecycle action.
 */
describe('Real Estate page — recording a sale', () => {
  it('opens a sale confirmation with the property\'s current value prefilled', async () => {
    const user = userEvent.setup();
    renderPage(<RealEstatePage />, { route: '/real-estate', handlers: reHandlers(), user: MEMBER_USER });
    await screen.findByText('Koramangala Flat');

    await user.click(screen.getByRole('button', { name: /^sell$/i }));

    expect(await screen.findByText(/record sale — koramangala flat/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sale price/i)).toHaveValue(8000000);
  });

  it('sends the sale price and date, and confirms with a success toast', async () => {
    const user = userEvent.setup();
    let body: any;
    renderPage(<RealEstatePage />, {
      route: '/real-estate',
      user: MEMBER_USER,
      handlers: [
        ...reHandlers(),
        http.post(url('/investments/real-estate/re-1/sell'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({
            data: { ...PROPERTY, soldAt: '2026-06-01T00:00:00.000Z', salePrice: 9500000 },
          });
        }),
      ],
    });
    await screen.findByText('Koramangala Flat');
    await user.click(screen.getByRole('button', { name: /^sell$/i }));

    const priceInput = await screen.findByLabelText(/sale price/i);
    await user.clear(priceInput);
    await user.type(priceInput, '9500000');
    await user.click(screen.getByRole('button', { name: /confirm sale/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ salePrice: 9500000 });
    await waitFor(() => {
      expect(screen.getByText(/sale recorded/i)).toBeInTheDocument();
    });
  });

  it('surfaces the loan-collateral guard as a toast, not a silent no-op', async () => {
    const user = userEvent.setup();
    renderPage(<RealEstatePage />, {
      route: '/real-estate',
      user: MEMBER_USER,
      handlers: [
        ...reHandlers(),
        http.post(url('/investments/real-estate/re-1/sell'), () => HttpResponse.json(
          { message: 'This still secures an active loan (HDFC Bank). Close or pay off the loan before recording a sale.' },
          { status: 409 },
        )),
      ],
    });
    await screen.findByText('Koramangala Flat');
    await user.click(screen.getByRole('button', { name: /^sell$/i }));
    await user.click(screen.getByRole('button', { name: /confirm sale/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/active loan/i).length).toBeGreaterThan(0);
    });
  });

  it('hides the Sell button and shows Sale Price instead of Current Value once sold', async () => {
    const SOLD = { ...PROPERTY, soldAt: '2026-06-01T00:00:00.000Z', salePrice: 9500000 };
    renderPage(<RealEstatePage />, { route: '/real-estate', user: MEMBER_USER, handlers: reHandlers([SOLD]) });
    await screen.findByText('Koramangala Flat');

    expect(screen.queryByRole('button', { name: /^sell$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/sale price/i)).toBeInTheDocument();
    // Exact text — "Total Current Value" in the portfolio summary card is unrelated and
    // must not collide with this.
    expect(screen.queryByText('Current Value')).not.toBeInTheDocument();
  });
});
