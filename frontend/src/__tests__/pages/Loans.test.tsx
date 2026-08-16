/**
 * Loans page — smoke. Full bar applies: "Loading loans…" is a real loading state,
 * distinct from the "No loans added yet" empty state.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import LoansPage from '@/pages/loans/Loans';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MONEY_FORMATTED, MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

const LOAN = {
  id: 'l-1',
  lenderName: 'HDFC Home Loan',
  loanType: 'HOME',
  principalAmount: 5000000,
  outstandingBalance: 4000000,
  interestRate: 8.5,
  tenureMonths: 240,
  emiAmount: 125000, // -> ₹1,25,000.00
  emiDate: 5,
  startDate: '2023-01-01T00:00:00.000Z',
  section24bEligible: true,
  userName: 'Asha',
};

const loanHandlers = (loans: unknown[] = [LOAN]) => [
  http.get(url('/loans'), () => HttpResponse.json({ data: loans })),
];

describe('Loans page — smoke', () => {
  it('shows loading, then renders loan data (the loading->loaded transition)', async () => {
    renderPage(<LoansPage />, { route: '/loans', handlers: loanHandlers() });

    // Leg 2: a genuine loading affordance.
    expect(screen.getByText(/Loading loans/i)).toBeInTheDocument();

    // Leg 3: sentinel appears only once data lands; loading is gone.
    expect(await screen.findByText('HDFC Home Loan')).toBeInTheDocument();
    expect(screen.queryByText(/Loading loans/i)).toBeNull();

    // Leg 4: the EMI renders with exact lakh grouping.
    expect(screen.getAllByText(MONEY_FORMATTED).length).toBeGreaterThan(0);
  });

  it('renders the page heading', async () => {
    renderPage(<LoansPage />, { route: '/loans', handlers: loanHandlers() });
    expect(
      await screen.findByRole('heading', { level: 1, name: /loans & emis/i }),
    ).toBeInTheDocument();
  });

  it('renders the empty state when there are no loans', async () => {
    renderPage(<LoansPage />, { route: '/loans', handlers: loanHandlers([]) });
    expect(await screen.findByText(/No loans added yet/i)).toBeInTheDocument();
  });

  it('a MEMBER can open the add-loan form', async () => {
    // MEMBER: create controls are gated on !isViewingFamilyWide.
    const user = userEvent.setup();
    renderPage(<LoansPage />, {
      route: '/loans', handlers: loanHandlers(), user: MEMBER_USER,
    });
    await screen.findByText('HDFC Home Loan');

    await user.click(await screen.findByRole('button', { name: /add loan/i }));

    expect(await screen.findByRole('heading', { name: /^add loan$/i })).toBeInTheDocument();
  });

  it('loads the amortization schedule on demand', async () => {
    const user = userEvent.setup();
    renderPage(<LoansPage />, {
      route: '/loans',
      handlers: [
        ...loanHandlers(),
        http.get(url('/loans/l-1/amortization-schedule'), () =>
          HttpResponse.json({
            data: {
              loan: LOAN,
              schedule: [{
                month: 1,
                date: '2023-02-01T00:00:00.000Z',
                emi: 125000,
                principal: 90000,
                interest: 35000,
                closingBalance: 4910000,
              }],
              summary: { totalInterest: 1000000, totalPayment: 6000000 },
            },
          })),
      ],
    });
    await screen.findByText('HDFC Home Loan');

    await user.click(screen.getByRole('button', { name: /schedule/i }));

    // Asserting the RESOLVED row, not the transient "Loading schedule…" text: that
    // state is too short-lived to observe reliably here, and the row proves the nested
    // query ran and rendered.
    expect(await screen.findByText('₹49,10,000.00')).toBeInTheDocument();
    expect(screen.queryByText(/Loading schedule/i)).toBeNull();
  });

  it('surfaces an error toast when the loans request fails', async () => {
    renderPage(<LoansPage />, {
      route: '/loans',
      handlers: [
        http.get(url('/loans'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
  });
});
