/**
 * Loans page — smoke. Full bar applies: "Loading loans…" is a real loading state,
 * distinct from the "No loans added yet" empty state.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
  loanAccountNumber: '1234567890',
  principalAmount: 5000000,
  outstandingBalance: 4000000,
  interestRate: 8.5,
  tenureMonths: 240,
  emiAmount: 125000, // -> ₹1,25,000.00
  emiDate: 5,
  disbursementDate: '2023-01-01T00:00:00.000Z',
  endDate: '2043-01-01T00:00:00.000Z',
  firstEmiDate: null,
  preEmiAmount: null,
  isTaxDeductible: true,
  section24bEligible: true,
  prepaymentChargesAmount: 25000,
  assetId: 'a-1',
  asset: { id: 'a-1', assetType: 'PROPERTY', name: 'Flat 3B', value: 8500000 },
  owners: [{ userId: 'u-member', sharePercent: 100, userName: 'Ravi' }],
  sharePercent: 100,
  outstandingBalanceShare: 4000000,
  emiAmountShare: 125000,
  userName: 'Asha',
};

const ASSETS = [
  { id: 'a-1', userId: 'u-member', assetType: 'PROPERTY', name: 'Flat 3B', value: 8500000 },
  { id: 'a-2', userId: 'u-member', assetType: 'VEHICLE', name: 'Swift Dzire', value: 600000 },
];

const DERIVED = {
  emiAmount: 43391.17,
  endDate: '2046-01-15T00:00:00.000Z',
  preEmiAmount: 67500,
  monthlyPreEmiAmount: 22500,
  outstandingBalance: 5000000,
};

const loanHandlers = (loans: unknown[] = [LOAN]) => [
  http.get(url('/loans'), () => HttpResponse.json({ data: loans })),
  http.get(url('/assets'), () => HttpResponse.json({ data: ASSETS })),
  http.post(url('/loans/derive'), () => HttpResponse.json({ data: DERIVED })),
];

/** Open the create form as a MEMBER (create controls are hidden family-wide). */
async function openCreateForm(user: ReturnType<typeof userEvent.setup>) {
  renderPage(<LoansPage />, { route: '/loans', handlers: loanHandlers(), user: MEMBER_USER });
  await screen.findByText('HDFC Home Loan');
  await user.click(await screen.findByRole('button', { name: /add loan/i }));
  return screen.findByRole('heading', { name: /^add loan$/i });
}

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
        // The page also fetches assets; without a handler MSW hard-fails the test.
        http.get(url('/assets'), () => HttpResponse.json({ data: ASSETS })),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
  });
});

// ─── Auto-fill: create mode only ─────────────────────────────────────────────

describe('Loans — auto-fill derived fields', () => {
  it('fills EMI, end date, pre-EMI and opening balance from the derive endpoint', async () => {
    const user = userEvent.setup();
    await openCreateForm(user);

    await user.type(screen.getByLabelText(/Principal Amount/i), '5000000');
    await user.type(screen.getByLabelText(/Interest Rate/i), '8.5');
    await user.type(screen.getByLabelText(/Tenure/i), '240');
    // Blur triggers the derive call.
    await user.tab();

    await waitFor(() => {
      expect(screen.getByLabelText(/^EMI Amount/i)).toHaveValue(DERIVED.emiAmount);
    });
    expect(screen.getByLabelText(/Outstanding Balance/i)).toHaveValue(DERIVED.outstandingBalance);
    expect(screen.getByLabelText(/^End Date/i)).toHaveValue('2046-01-15');
    expect(screen.getByLabelText(/^Pre-EMI Amount/i)).toHaveValue(DERIVED.preEmiAmount);
  });

  it('does not call derive until principal, rate and tenure are all present', async () => {
    const user = userEvent.setup();
    let derives = 0;

    renderPage(<LoansPage />, {
      route: '/loans',
      user: MEMBER_USER,
      handlers: [
        http.get(url('/loans'), () => HttpResponse.json({ data: [LOAN] })),
        http.get(url('/assets'), () => HttpResponse.json({ data: ASSETS })),
        http.post(url('/loans/derive'), () => { derives += 1; return HttpResponse.json({ data: DERIVED }); }),
      ],
    });
    await screen.findByText('HDFC Home Loan');
    await user.click(await screen.findByRole('button', { name: /add loan/i }));

    // Principal alone is not enough to derive anything.
    await user.type(await screen.findByLabelText(/Principal Amount/i), '5000000');
    await user.tab();

    await waitFor(() => expect(screen.getByLabelText(/Interest Rate/i)).toBeInTheDocument());
    expect(derives).toBe(0);
  });

  it('survives a derive failure without blocking manual entry', async () => {
    const user = userEvent.setup();
    renderPage(<LoansPage />, {
      route: '/loans',
      user: MEMBER_USER,
      handlers: [
        http.get(url('/loans'), () => HttpResponse.json({ data: [LOAN] })),
        http.get(url('/assets'), () => HttpResponse.json({ data: ASSETS })),
        http.post(url('/loans/derive'), () => HttpResponse.json({ message: 'nope' }, { status: 500 })),
      ],
    });
    await screen.findByText('HDFC Home Loan');
    await user.click(await screen.findByRole('button', { name: /add loan/i }));

    await user.type(await screen.findByLabelText(/Principal Amount/i), '5000000');
    await user.type(screen.getByLabelText(/Interest Rate/i), '8.5');
    await user.type(screen.getByLabelText(/Tenure/i), '240');
    await user.tab();

    // The form is still usable; the user can type an EMI themselves.
    const emi = screen.getByLabelText(/^EMI Amount/i);
    await user.type(emi, '43391');
    expect(emi).toHaveValue(43391);
  });

  it('NEVER overwrites the outstanding balance when editing an existing loan', async () => {
    // The trap: startEdit calls setValue() without { shouldDirty: true }, so a
    // dirtyFields-based guard would read "untouched" and let auto-fill reset the
    // balance to the principal — wiping years of repayment. Auto-fill is gated on
    // create mode instead, so editing the principal must leave the balance alone.
    const user = userEvent.setup();
    renderPage(<LoansPage />, { route: '/loans', handlers: loanHandlers(), user: MEMBER_USER });
    await screen.findByText('HDFC Home Loan');

    await user.click(screen.getByRole('button', { name: /edit loan/i }));
    await screen.findByRole('heading', { name: /edit loan/i });

    const balance = screen.getByLabelText(/Outstanding Balance/i);
    expect(balance).toHaveValue(4000000); // the real, part-repaid figure

    const principal = screen.getByLabelText(/Principal Amount/i);
    await user.clear(principal);
    await user.type(principal, '6000000');
    await user.tab();

    // Still the real balance — not reset to the new principal.
    await waitFor(() => expect(balance).toHaveValue(4000000));
    expect(balance).not.toHaveValue(6000000);
  });
});

// ─── startEdit populates the form correctly ──────────────────────────────────

describe('Loans — edit form population', () => {
  it('loads scalar fields, dates and owners without corrupting the form', async () => {
    const user = userEvent.setup();
    renderPage(<LoansPage />, { route: '/loans', handlers: loanHandlers(), user: MEMBER_USER });
    await screen.findByText('HDFC Home Loan');

    await user.click(screen.getByRole('button', { name: /edit loan/i }));
    await screen.findByRole('heading', { name: /edit loan/i });

    expect(screen.getByLabelText(/Lender Name/i)).toHaveValue('HDFC Home Loan');
    expect(screen.getByLabelText(/Interest Rate/i)).toHaveValue(8.5);
    // Dates are sliced to yyyy-mm-dd for the date input.
    expect(screen.getByLabelText(/Disbursement Date/i)).toHaveValue('2023-01-01');
    expect(screen.getByLabelText(/Prepayment Charges/i)).toHaveValue(25000);
    // owners is an array — it must reach the field array, not a text input.
    expect(screen.getByLabelText(/Owner 1/i)).toHaveValue('u-member');
    expect(screen.getByLabelText(/Share 1/i)).toHaveValue(100);
  });

  it('seeds a single 100% owner when creating', async () => {
    const user = userEvent.setup();
    await openCreateForm(user);
    expect(screen.getByLabelText(/Share 1/i)).toHaveValue(100);
  });
});

// ─── Owners editor ───────────────────────────────────────────────────────────

describe('Loans — owners editor', () => {
  it('adds and removes owner rows, and shows the running total', async () => {
    const user = userEvent.setup();
    await openCreateForm(user);

    expect(screen.getByText(/Total 100%/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add owner/i }));
    expect(await screen.findByLabelText(/Owner 2/i)).toBeInTheDocument();

    // A second row at 0% drops the total below 100.
    await waitFor(() => expect(screen.getByText(/Total 100%/i)).toBeInTheDocument());

    await user.click(screen.getAllByTitle(/remove owner/i)[1]);
    await waitFor(() => expect(screen.queryByLabelText(/Owner 2/i)).toBeNull());
  });

  it('cannot remove the last remaining owner', async () => {
    const user = userEvent.setup();
    await openCreateForm(user);
    expect(screen.getByTitle(/remove owner/i)).toBeDisabled();
  });

  it('shows the running total turning invalid when shares do not reach 100', async () => {
    const user = userEvent.setup();
    await openCreateForm(user);

    const share = screen.getByLabelText(/Share 1/i);
    await user.clear(share);
    await user.type(share, '60');

    // The live total is the immediate feedback; zod's cross-field rule fires on submit,
    // which needs every other required field filled first.
    expect(await screen.findByText(/Total 60%/i)).toBeInTheDocument();
  });
});

// ─── Secured loans require an asset ──────────────────────────────────────────

describe('Loans — asset link', () => {
  it('marks the asset required for a secured type and blocks submit without one', async () => {
    const user = userEvent.setup();
    await openCreateForm(user);

    // HOME is the default, and is secured.
    await user.type(screen.getByLabelText(/Lender Name/i), 'ICICI');
    await user.type(screen.getByLabelText(/Principal Amount/i), '1000000');
    await user.type(screen.getByLabelText(/Outstanding Balance/i), '1000000');
    await user.type(screen.getByLabelText(/Interest Rate/i), '9');
    await user.type(screen.getByLabelText(/^EMI Amount/i), '9000');
    await user.type(screen.getByLabelText(/^EMI Date/i), '5');
    await user.type(screen.getByLabelText(/Tenure/i), '120');

    await user.click(screen.getAllByRole('button', { name: /^Add Loan$/ }).at(-1)!);

    expect(await screen.findByText(/is secured — link the asset/i)).toBeInTheDocument();
  });

  it('offers every asset in the picker', async () => {
    const user = userEvent.setup();
    await openCreateForm(user);

    const picker = screen.getByLabelText(/Secured Against/i);
    expect(within(picker).getByRole('option', { name: /Flat 3B/ })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: /Swift Dzire/ })).toBeInTheDocument();
  });

  it('does not require an asset for an unsecured type', async () => {
    const user = userEvent.setup();
    await openCreateForm(user);

    await user.selectOptions(screen.getByLabelText(/Loan Type/i), 'PERSONAL');
    // The picker's placeholder flips to reflect that it is optional.
    expect(await screen.findByRole('option', { name: /Not secured/i })).toBeInTheDocument();
  });
});

// ─── Share-weighted display ──────────────────────────────────────────────────

describe('Loans — co-ownership display', () => {
  const coOwned = {
    ...LOAN,
    owners: [
      { userId: 'u-member', sharePercent: 60, userName: 'Ravi' },
      { userId: 'u-admin', sharePercent: 40, userName: 'Asha' },
    ],
    sharePercent: 60,
    outstandingBalanceShare: 2400000,
    emiAmountShare: 75000,
  };

  it('lists every owner with their share', async () => {
    renderPage(<LoansPage />, {
      route: '/loans', handlers: loanHandlers([coOwned]), user: MEMBER_USER,
    });
    await screen.findByText('HDFC Home Loan');

    expect(screen.getByText(/Ravi 60%/)).toBeInTheDocument();
    expect(screen.getByText(/Asha 40%/)).toBeInTheDocument();
  });

  it('discloses that the view counts only the user\'s share', async () => {
    renderPage(<LoansPage />, {
      route: '/loans', handlers: loanHandlers([coOwned]), user: MEMBER_USER,
    });
    await screen.findByText('HDFC Home Loan');

    expect(await screen.findByText(/This view counts 60% of this loan/i)).toBeInTheDocument();
  });

  it('header totals use the share, so they agree with the dashboard', async () => {
    renderPage(<LoansPage />, {
      route: '/loans', handlers: loanHandlers([coOwned]), user: MEMBER_USER,
    });
    await screen.findByText('HDFC Home Loan');

    // The monthly EMI burden card renders the SHARE (₹75,000), not the full ₹1,25,000.
    // An unweighted sum here would contradict the share-weighted dashboard.
    // The "Monthly EMI Burden" card sums emiAmountShare, so a 60% owner sees ₹75,000
    // rather than the full ₹1,25,000 — matching what the dashboard reports.
    await waitFor(() => {
      expect(screen.getAllByText('₹75,000.00').length).toBeGreaterThan(0);
    });
  });

  it('omits the disclosure for a solely-owned loan', async () => {
    renderPage(<LoansPage />, { route: '/loans', handlers: loanHandlers(), user: MEMBER_USER });
    await screen.findByText('HDFC Home Loan');
    expect(screen.queryByText(/This view counts/i)).toBeNull();
  });
});

// ─── Pre-EMI display ─────────────────────────────────────────────────────────

describe('Loans — pre-EMI', () => {
  it('shows the pre-EMI interest when the loan has a moratorium', async () => {
    const withPreEmi = { ...LOAN, firstEmiDate: '2023-04-01T00:00:00.000Z', preEmiAmount: 67500 };
    renderPage(<LoansPage />, {
      route: '/loans', handlers: loanHandlers([withPreEmi]), user: MEMBER_USER,
    });
    await screen.findByText('HDFC Home Loan');

    expect(await screen.findByText(/Pre-EMI Interest/i)).toBeInTheDocument();
    expect(screen.getByText('₹67,500.00')).toBeInTheDocument();
  });

  it('hides the pre-EMI row when there is no moratorium', async () => {
    renderPage(<LoansPage />, { route: '/loans', handlers: loanHandlers(), user: MEMBER_USER });
    await screen.findByText('HDFC Home Loan');
    expect(screen.queryByText(/Pre-EMI Interest/i)).toBeNull();
  });

  it('names the asset the loan is secured against', async () => {
    renderPage(<LoansPage />, { route: '/loans', handlers: loanHandlers(), user: MEMBER_USER });
    await screen.findByText('HDFC Home Loan');
    expect(await screen.findByText(/Secured Against/i)).toBeInTheDocument();
    expect(screen.getByText('Flat 3B')).toBeInTheDocument();
  });
});

// ─── What the form actually PUTs on the wire ─────────────────────────────────
//
// This suite previously had no POST or PUT handler for /loans at all, so no test ever
// completed a submit — the request body had never once been asserted. That blind spot
// hid a pair of 500s: a cleared date field serializes as `""`, not as an absent key, and
// both `firstEmiDate: ""` and `assetId: ""` reached the backend, where they became an
// Invalid Date and an FK matching no row.

describe('Loans page — submitted payload', () => {
  it('a legacy loan with every optional field empty can be saved', async () => {
    const user = userEvent.setup();
    let body: any = null;

    renderPage(<LoansPage />, {
      route: '/loans',
      user: MEMBER_USER,
      handlers: [
        ...loanHandlers(),
        http.put(url('/loans/l-1'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: LOAN });
        }),
      ],
    });

    await screen.findByText('HDFC Home Loan');
    await user.click(screen.getByRole('button', { name: /edit loan/i }));
    await screen.findByRole('heading', { name: /edit loan/i });

    const emi = screen.getByLabelText(/^EMI Amount/i);
    await user.clear(emi);
    await user.type(emi, '46000');
    await user.click(screen.getByRole('button', { name: /save|update/i }));

    await waitFor(() => expect(body).not.toBeNull());

    // The exact shapes that used to 500. A cleared field must go out as null, never as
    // an empty string the backend would hand to `new Date()` or use as a foreign key.
    expect(body.firstEmiDate).toBeNull();
    expect(body.emiAmount).toBe(46000);
  });

  it('clearing the pre-EMI field does not write a zero over it', async () => {
    // z.coerce.number() turned a cleared input into 0, so every edit of a loan with no
    // pre-EMI wrote 0 and the dashboard then alerted "Pre-EMI: ₹0 due".
    const user = userEvent.setup();
    let body: any = null;

    renderPage(<LoansPage />, {
      route: '/loans',
      user: MEMBER_USER,
      handlers: [
        ...loanHandlers(),
        http.put(url('/loans/l-1'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: LOAN });
        }),
      ],
    });

    await screen.findByText('HDFC Home Loan');
    await user.click(screen.getByRole('button', { name: /edit loan/i }));
    await screen.findByRole('heading', { name: /edit loan/i });

    await user.click(screen.getByRole('button', { name: /save|update/i }));
    await waitFor(() => expect(body).not.toBeNull());

    // Absent or null are both fine — they mean "leave it unset". 0 is not: it is a
    // real value the dashboard reads back as a ₹0 pre-EMI due.
    expect(body.preEmiAmount ?? null).toBeNull();
    expect(body.preEmiAmount).not.toBe(0);
  });
});


// ─── Date presentation ───────────────────────────────────────────────────────

/**
 * `toLocaleDateString('en-IN')` renders 1 January 2043 as "1/1/2043", not "01/01/2043".
 * Nothing asserted on rendered dates before, so a silent revert to the locale formatter
 * would have gone unnoticed everywhere outside Subscriptions.
 */
describe('Loans page — dates render as dd/mm/yyyy', () => {
  it('zero-pads a single-digit day and month', () => {
    // LOAN.endDate is 2043-01-01 — the case en-IN got wrong.
    renderPage(<LoansPage />, { route: '/loans', handlers: loanHandlers(), user: MEMBER_USER });

    return screen.findByText('01/01/2043').then((el) => expect(el).toBeInTheDocument());
  });

  it('shows the EMI as a real next date rather than a bare day number', async () => {
    // emiDate is a day-of-month Int (5). It used to render "on 5th" — which also produced
    // "1th" and "21th". Asserting SHAPE rather than a pinned date: the arithmetic is
    // exhaustively covered in the pure tests, and fake timers here stall MSW.
    renderPage(<LoansPage />, { route: '/loans', handlers: loanHandlers(), user: MEMBER_USER });

    expect(await screen.findByText(/^Next: \d{2}\/\d{2}\/\d{4}$/)).toBeInTheDocument();
    expect(screen.queryByText(/on 5th/)).not.toBeInTheDocument();
  });
});
