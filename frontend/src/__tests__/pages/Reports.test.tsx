/**
 * Reports page — smoke.
 *
 * One of only two pages with a genuine `if (isLoading) return <PageLoader />` (:124-125),
 * so awaiting the <h1> here really does prove the transition. The sentinel is still
 * data-derived for consistency with every other page test.
 *
 * The trial-balance query is gated on `activeTab === 'trialbalance'` (:121), so its
 * handler must be registered before the tab is clicked — with onUnhandledRequest:'error'
 * a missing one is a hard failure, not a silent empty table.
 *
 * Handler count: 4 page-specific + 5 base = 9.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import ReportsPage from '@/pages/admin/Reports';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';

failOnConsoleError();

/** Mirrors the literal `tabs` array at Reports.tsx:83-88. */
// `marker` must appear ONLY in the tab BODY. Matching the tab label instead would be
// satisfied by the button itself, which is on screen before the click — the assertion
// would pass even with tab switching completely broken.
const TABS = [
  { id: 'pl', label: 'P&L', marker: /Total Income/ },
  { id: 'spending', label: 'Spending Analysis', marker: /Spending by Category/ },
  { id: 'networth', label: 'Net Worth (Balance Sheet)', marker: /^Assets$/ },
  { id: 'trialbalance', label: 'Trial Balance', marker: /Trial Balance — FY/ },
] as const;

const PNL = {
  fy: '2025-26',
  summary: { totalIncome: 900000, totalExpense: 400000, netSavings: 500000, savingsRate: 55.5 },
  monthly: [
    { month: "Apr '25", monthIndex: 3, year: 2025, income: 75000, expense: 40000, net: 35000 },
  ],
  expenseCategories: [{ categoryId: 'cat-food', categoryName: 'Food', total: 40000 }],
  incomeCategories: [{ categoryId: 'cat-sal', categoryName: 'Salary', total: 75000 }],
};

const SPENDING = [{ categoryId: 'cat-food', categoryName: 'Food', total: 40000, txCount: 12 }];

const NET_WORTH_STATEMENT = {
  assets: [{ label: 'Bank Accounts', value: 125000 }],
  liabilities: [{ label: 'Home Loan', value: 25000 }],
  totalAssets: 125000,
  totalLiabilities: 25000,
  netWorth: 100000,
};

const TRIAL_BALANCE = {
  fy: '2025-26',
  entries: [{ accountName: 'Salary', type: 'CREDIT' as const, debit: 0, credit: 75000 }],
  totals: {
    totalDebits: 40000, totalCredits: 75000, netSavings: 35000,
    rawTotalIncome: 75000, rawTotalExpenses: 40000,
  },
};

function reportHandlers() {
  return [
    http.get(url('/reports/profit-and-loss'), () => HttpResponse.json({ data: PNL })),
    http.get(url('/reports/spending-by-category'), () => HttpResponse.json({ data: SPENDING })),
    http.get(url('/reports/net-worth-statement'), () =>
      HttpResponse.json({ data: NET_WORTH_STATEMENT })),
    http.get(url('/reports/trial-balance'), () => HttpResponse.json({ data: TRIAL_BALANCE })),
  ];
}

describe('Reports page — smoke', () => {
  it('shows loading, then renders P&L data (the loading->loaded transition)', async () => {
    renderPage(<ReportsPage />, { route: '/reports', handlers: reportHandlers() });

    // Real PageLoader here, unlike most pages.
    expect(screen.getByRole('status')).toBeInTheDocument();

    expect(await screen.findByRole('heading', { level: 1, name: /reports/i })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders every tab control', async () => {
    renderPage(<ReportsPage />, { route: '/reports', handlers: reportHandlers() });
    await screen.findByRole('heading', { level: 1, name: /reports/i });

    // waitFor around the WHOLE assertion, not just findBy. The page re-enters loading
    // once isAdmin flips true and enables the members query, so a node findBy has already
    // resolved can be unmounted before toBeInTheDocument runs — which is precisely how
    // this passed locally and failed on CI.
    for (const t of TABS) {
      await waitFor(() => {
        expect(screen.getByRole('button', { name: t.label })).toBeInTheDocument();
      });
    }
  });

  it.each(TABS)('mounts the $label tab body', async ({ label, marker }) => {
    const user = userEvent.setup();
    renderPage(<ReportsPage />, { route: '/reports', handlers: reportHandlers() });
    await screen.findByRole('heading', { level: 1, name: /reports/i });

    await user.click(await screen.findByRole('button', { name: label }));

    // Assert a string from the tab BODY. Asserting the tab button still exists would
    // pass with tab switching entirely disabled — verified by mutation.
    expect(await screen.findByText(marker)).toBeInTheDocument();
  });

  it('fetches the trial balance only after its tab is selected', async () => {
    let tbCalls = 0;
    const user = userEvent.setup();
    renderPage(<ReportsPage />, {
      route: '/reports',
      handlers: [
        http.get(url('/reports/trial-balance'), () => {
          tbCalls += 1;
          return HttpResponse.json({ data: TRIAL_BALANCE });
        }),
        ...reportHandlers(),
      ],
    });
    await screen.findByRole('heading', { level: 1, name: /reports/i });

    // Gated by `enabled: activeTab === 'trialbalance'` (:121).
    expect(tbCalls).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Trial Balance' }));

    await waitFor(() => expect(tbCalls).toBe(1));
  });

  it('surfaces an error toast when the P&L request fails', async () => {
    renderPage(<ReportsPage />, {
      route: '/reports',
      handlers: [
        http.get(url('/reports/profit-and-loss'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
        ...reportHandlers(),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
  });
});
