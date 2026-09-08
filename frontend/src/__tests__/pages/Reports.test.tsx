/**
 * Reports page — smoke.
 *
 * One of only two pages with a genuine `if (isLoading) return <PageLoader />`
 * (the `isLoading = isPnLLoading || (isAdmin && isMembersLoading)` gate), so awaiting
 * the <h1> here really does prove the transition. The sentinel is still data-derived
 * for consistency with every other page test.
 *
 * The trial-balance query is gated on `enabled: activeTab === 'trialbalance'`, so its
 * handler must be registered before the tab is clicked — with onUnhandledRequest:'error'
 * a missing one is a hard failure, not a silent empty table.
 *
 * Handler count: 4 page-specific + 6 base = 10.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import ReportsPage from '@/pages/admin/Reports';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

/** Mirrors the literal `tabs` array in Reports.tsx. */
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

    // Gated by `enabled: activeTab === 'trialbalance'`.
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

    // Two independent signals on the same failure: the global toast (this app's
    // interceptor-driven `api:error` dispatch, NOT the dormant queryCache handler —
    // renderPage's test QueryClient has no queryCache at all) fires the raw server
    // message, while the page's OWN inline banner (rendered from `isPnLError`) shows
    // its own fixed copy. Both must be asserted — a toast firing doesn't prove the
    // in-page error state (with its Retry button) actually rendered.
    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
    expect(await screen.findByText('Failed to load P&L data')).toBeInTheDocument();
  });
});

describe('Reports page — Spending Analysis error/loading states', () => {
  it('shows a persistent, retriable banner on failure — not the misleading empty state', async () => {
    renderPage(<ReportsPage />, {
      // Deliberately NOT ?targetUserId= — that would re-key the query and defeat any
      // call-counting in a sibling test relying on the same handler shape.
      route: '/reports?tab=spending',
      handlers: [
        // Deliberately a DIFFERENT message than the banner's own fixed copy: if they
        // matched, the assertion below could be satisfied by the transient global
        // toast instead of the actual in-page banner — a false-green that wouldn't
        // catch a regression where the banner itself never renders.
        http.get(url('/reports/spending-by-category'), () =>
          HttpResponse.json({ message: 'Spending blew up' }, { status: 500 })),
        ...reportHandlers(),
      ],
    });

    expect(await screen.findByText('Failed to load spending data')).toBeInTheDocument();
    expect(screen.queryByText('No spending data for this FY')).not.toBeInTheDocument();
  });

  it('shows a loading state while in flight — not the misleading empty state', async () => {
    renderPage(<ReportsPage />, {
      route: '/reports?tab=spending',
      handlers: [
        http.get(url('/reports/spending-by-category'), async () => {
          await delay(200);
          return HttpResponse.json({ data: SPENDING });
        }),
        ...reportHandlers(),
      ],
    });

    expect(await screen.findByText(/Loading spending data/)).toBeInTheDocument();
    expect(screen.queryByText('No spending data for this FY')).not.toBeInTheDocument();

    expect(await screen.findByText('Food')).toBeInTheDocument();
  });

  it('Retry actually refetches — recovers to real data, or correctly falls through to the empty state', async () => {
    const user = userEvent.setup();
    let call = 0;
    renderPage(<ReportsPage />, {
      route: '/reports?tab=spending',
      handlers: [
        http.get(url('/reports/spending-by-category'), () => {
          call += 1;
          if (call === 1) return HttpResponse.json({ message: 'Spending blew up' }, { status: 500 });
          return HttpResponse.json({ data: SPENDING });
        }),
        ...reportHandlers(),
      ],
    });

    await screen.findByText('Failed to load spending data');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    // Legend list text, not chart internals — recharts' ResponsiveContainer renders at
    // 0x0 under jsdom regardless of data, so it can never be a meaningful assertion
    // target here.
    expect(await screen.findByText('Food')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load spending data')).not.toBeInTheDocument();
    expect(call).toBe(2);
  });

  it('Retry succeeding with genuinely empty data falls through to the empty state, not the banner', async () => {
    const user = userEvent.setup();
    let call = 0;
    renderPage(<ReportsPage />, {
      route: '/reports?tab=spending',
      handlers: [
        http.get(url('/reports/spending-by-category'), () => {
          call += 1;
          if (call === 1) return HttpResponse.json({ message: 'Spending blew up' }, { status: 500 });
          return HttpResponse.json({ data: [] });
        }),
        ...reportHandlers(),
      ],
    });

    await screen.findByText('Failed to load spending data');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No spending data for this FY')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load spending data')).not.toBeInTheDocument();
  });
});

describe('Reports page — deep link from Dashboard\'s family-spending chart', () => {
  it('an ADMIN arriving via ?tab=spending&targetUserId=X lands on Spending Analysis, scoped to that member', async () => {
    let seenTargetUserId: string | null | undefined;
    renderPage(<ReportsPage />, {
      route: '/reports?tab=spending&targetUserId=u-member',
      handlers: [
        http.get(url('/reports/spending-by-category'), ({ request }) => {
          seenTargetUserId = new URL(request.url).searchParams.get('targetUserId');
          return HttpResponse.json({ data: SPENDING });
        }),
        ...reportHandlers(),
      ],
    });

    // Lands on Spending Analysis without clicking the tab button.
    expect(await screen.findByText(/Spending by Category/)).toBeInTheDocument();
    await waitFor(() => expect(seenTargetUserId).toBe('u-member'));
  });

  it('a MEMBER visiting the same deep link also lands on Spending Analysis, but targetUserId is never sent (own data only)', async () => {
    let seenTargetUserId: string | null | undefined = 'not-called';
    renderPage(<ReportsPage />, {
      route: '/reports?tab=spending&targetUserId=u-member',
      user: MEMBER_USER,
      handlers: [
        http.get(url('/reports/spending-by-category'), ({ request }) => {
          seenTargetUserId = new URL(request.url).searchParams.get('targetUserId');
          return HttpResponse.json({ data: SPENDING });
        }),
        ...reportHandlers(),
      ],
    });

    expect(await screen.findByText(/Spending by Category/)).toBeInTheDocument();
    await waitFor(() => expect(seenTargetUserId).toBeNull());
  });

  it('ignores a targetUserId that is not in the loaded members list (stale/bookmarked link to a since-removed member)', async () => {
    let seenTargetUserId: string | null | undefined = 'not-called';
    renderPage(<ReportsPage />, {
      route: '/reports?tab=spending&targetUserId=u-deleted-or-deactivated',
      handlers: [
        http.get(url('/reports/spending-by-category'), ({ request }) => {
          seenTargetUserId = new URL(request.url).searchParams.get('targetUserId');
          return HttpResponse.json({ data: SPENDING });
        }),
        ...reportHandlers(),
      ],
    });

    // Still lands on the Spending tab (tab-switch isn't gated on validity) — the point
    // is that the unrecognized id is never applied as the scope, not that navigation
    // fails outright.
    expect(await screen.findByText(/Spending by Category/)).toBeInTheDocument();
    await waitFor(() => expect(seenTargetUserId).toBeNull());
  });

  it('reflects the scoped member in the View: selector after arriving via the deep link', async () => {
    renderPage(<ReportsPage />, {
      route: '/reports?tab=spending&targetUserId=u-member',
      handlers: reportHandlers(),
    });

    await screen.findByText(/Spending by Category/);
    await waitFor(() => {
      const select = screen.getByLabelText(/View:/i) as HTMLSelectElement;
      expect(select.value).toBe('u-member');
    });
  });
});
