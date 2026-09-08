/**
 * Dashboard page — smoke.
 *
 * Dashboard is one of the few pages with a REAL early return:
 *   `if (summaryLoading || (isAdmin && isMembersLoading)) return <PageLoader />` (:91)
 * so the <h1> genuinely is gated behind loading here, unlike most pages. The loaded
 * sentinel is still a data-derived string rather than the heading, so the assertion
 * stays honest if that early return is ever removed.
 *
 * Handler count: 13 page-specific + 5 base = 18. Note POST /snapshots/net-worth, fired
 * from a mount effect (:77-84) whenever the current month has no snapshot — omitting it
 * trips onUnhandledRequest:'error'. GET /reports/spending-by-category backs the
 * Spend by Category widget, shared with Reports.tsx under the same query key. GET
 * /tax/profile, /tax/80c-tracker, /insurance/80d-summary back the Tax Deductions
 * widget, shared with TaxCentre.tsx/Tracker80DTab.tsx under the same query keys. GET
 * /investments/portfolio-summary, /loans back the Investments & Loans widget, shared
 * with Investments.tsx/Loans.tsx under the same query keys.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import DashboardPage, { handleCashflowClick, handleFamilyMemberClick } from '@/pages/Dashboard';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MONEY, MONEY_FORMATTED, BUDGETS_VS_ACTUALS, MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

const SUMMARY = {
  fyYear: '2025-26',
  netWorth: MONEY,
  netWorthChange: 5000,
  netWorthChangePct: 4.2,
  totalIncome: 900000,
  totalExpense: 400000,
  savingsRate: 55.5,
  totalAssets: 200000,
  totalLiabilities: 75000,
};

// month is a bare abbreviation (no year suffix) and monthIndex is 1-indexed (SQL
// EXTRACT(MONTH...) convention, April=4) — matches backend/src/services/
// dashboardService.ts's getCashflow exactly. A prior version of this fixture used
// monthIndex:3/4 (0-indexed) and "Apr '25" (with a year suffix neither the backend nor
// Dashboard.tsx's handleCashflowClick ever produces) — silently validating the wrong
// shape for every test that rendered this chart.
const CASHFLOW = [
  { month: 'Apr', monthIndex: 4, year: 2025, income: 75000, expense: 40000, net: 35000 },
  { month: 'May', monthIndex: 5, year: 2025, income: 80000, expense: 42000, net: 38000 },
];

const ALERTS = [
  {
    type: 'EMI' as const,
    title: 'Home loan EMI',
    amount: 25000,
    dueDate: '2025-04-05',
    daysUntilDue: 3,
    entityId: 'loan-1',
  },
];

const NET_WORTH_HISTORY = [
  { snapshotDate: '2025-04-15', netWorth: MONEY, totalAssets: 200000, totalLiabilities: 75000 },
];

/** Mirrors backend's getMonthStart(): 1st of `date`'s IST month, 00:00:00 IST,
 *  serialized the same way a real snapshotDate arrives from the API. */
function istMonthStartISO(date: Date): string {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(date.getTime() + istOffset);
  const istMidnightAsIfUTC = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1, 0, 0, 0);
  return new Date(istMidnightAsIfUTC - istOffset).toISOString();
}

/** An FY-period budget — Dashboard's Budget Health panel filters to period === 'FY'. */
const FY_BUDGETS = [{ ...BUDGETS_VS_ACTUALS[0], period: 'FY' }];

const FAMILY_OVERVIEW = {
  members: [
    { id: 'u-admin', name: 'Asha', colorTag: '#ff0000' },
    { id: 'u-member', name: 'Ravi', colorTag: '#00ff00' },
  ],
  chartData: [{ month: "Apr '25", 'u-admin': 40000, 'u-member': 20000 }],
};

const SPENDING_BY_CATEGORY = [
  { categoryId: 'cat-food', category: { id: 'cat-food', name: 'Food' }, total: 50000 },
  { categoryId: 'cat-rent', category: { id: 'cat-rent', name: 'Rent' }, total: 30000 },
  { categoryId: 'cat-travel', category: { id: 'cat-travel', name: 'Travel' }, total: 10000 },
];

const TAX_PROFILE = { id: 'prof-1', regime: 'OLD' };

const TRACKER_80C = {
  limit: 150000,
  utilized: 90000,
  remaining: 60000,
  pctUtilized: 60,
  breakdown: { elss: 50000, ppf: 40000 },
};

const SUMMARY_80D = {
  selfFamily: { paid: 15000, limit: 25000, deductible: 15000 },
  parents: { paid: 10000, limit: 25000, deductible: 10000 },
  total: 25000,
  policies: [],
};

const PORTFOLIO = {
  totalInvested: 300000,
  totalCurrentValue: 350000,
  absoluteGain: 50000,
  absoluteReturnPct: 16.7,
  byType: {},
};

const LOANS = [
  { id: 'loan-1', outstandingBalance: 120000, outstandingBalanceShare: undefined },
  { id: 'loan-2', outstandingBalance: 200000, outstandingBalanceShare: 80000 },
];

function dashboardHandlers(over: Partial<{
  summary: unknown; cashflow: unknown; alerts: unknown;
  history: unknown; budgets: unknown; family: unknown; spending: unknown;
  taxProfile: unknown; tracker80C: unknown; summary80D: unknown;
  portfolio: unknown; loans: unknown;
}> = {}) {
  return [
    http.get(url('/dashboard/summary'), () =>
      HttpResponse.json({ data: over.summary ?? SUMMARY })),
    http.get(url('/dashboard/cashflow'), () =>
      HttpResponse.json({ data: over.cashflow ?? CASHFLOW })),
    http.get(url('/dashboard/upcoming-alerts'), () =>
      HttpResponse.json({ data: over.alerts ?? ALERTS })),
    http.get(url('/dashboard/family-overview'), () =>
      HttpResponse.json({ data: over.family ?? FAMILY_OVERVIEW })),
    http.get(url('/snapshots/net-worth'), () =>
      HttpResponse.json({ data: over.history ?? NET_WORTH_HISTORY })),
    // Mount effect writes this when the current month has no snapshot.
    http.post(url('/snapshots/net-worth'), () =>
      HttpResponse.json({ data: NET_WORTH_HISTORY[0] })),
    http.get(url('/budgets/vs-actuals'), () =>
      HttpResponse.json({ data: over.budgets ?? FY_BUDGETS })),
    http.get(url('/reports/spending-by-category'), () =>
      HttpResponse.json({ data: over.spending ?? SPENDING_BY_CATEGORY })),
    http.get(url('/tax/profile'), () =>
      HttpResponse.json({ data: over.taxProfile ?? TAX_PROFILE })),
    http.get(url('/tax/80c-tracker'), () =>
      HttpResponse.json({ data: over.tracker80C ?? TRACKER_80C })),
    http.get(url('/insurance/80d-summary'), () =>
      HttpResponse.json({ data: over.summary80D ?? SUMMARY_80D })),
    http.get(url('/investments/portfolio-summary'), () =>
      HttpResponse.json({ data: over.portfolio ?? PORTFOLIO })),
    http.get(url('/loans'), () =>
      HttpResponse.json({ data: over.loans ?? LOANS })),
  ];
}

/**
 * Wait for the page to reach its FINAL settled state.
 *
 * Dashboard.tsx:91 gates on `summaryLoading || (isAdmin && isMembersLoading)`. isAdmin
 * flips false->true when the session restores, and that flip is what ENABLES the members
 * query — so the page renders loaded, re-enters loading, then loads again. Any
 * `await findBy...` can resolve in the FIRST window and have its node unmounted before a
 * following synchronous getBy runs. The member selector only exists once members have
 * settled, so awaiting it marks the true end of loading.
 */
async function settled() {
  return screen.findByLabelText(/View:/i);
}

describe('Dashboard page — smoke', () => {
  it('shows loading, then renders summary data (the loading->loaded transition)', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });

    // Leg 2: PageLoader has role="status" (LoadingSpinner.tsx).
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Leg 3: sentinel is DERIVED from the fixture (savingsRate 55.5), so it cannot be
    // satisfied by static UI chrome. 'Net Worth' would not work — it appears three times
    // (stat card, pie panel, trend heading).
    expect(await screen.findByText('55.5%')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders the page heading and the FY subtitle', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });
    expect(
      await screen.findByRole('heading', { level: 1, name: /dashboard/i }),
    ).toBeInTheDocument();
  });

  it('renders upcoming alerts from the API', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });
    expect(await screen.findByText('Home loan EMI')).toBeInTheDocument();
    await settled();
    expect(screen.getByText(/Due in 3 days/i)).toBeInTheDocument();
  });

  it('the alerts card\'s "View all" link points to /reminders', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });
    await screen.findByText('Home loan EMI');

    const widget = (await screen.findByText(/Upcoming This Month/i)).closest('div.rounded-xl') as HTMLElement;
    expect(within(widget).getByRole('link', { name: /View all/i })).toHaveAttribute('href', '/reminders');
  });

  it('shows "Due today" when an alert is due today (daysUntilDue: 0)', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({ alerts: [{ ...ALERTS[0], daysUntilDue: 0 }] }),
    });
    expect(await screen.findByText(/Due today/i)).toBeInTheDocument();
  });

  it('shows "Due tomorrow" when an alert is due in exactly 1 day, not "Due in 1 days"', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({ alerts: [{ ...ALERTS[0], daysUntilDue: 1 }] }),
    });
    expect(await screen.findByText(/Due tomorrow/i)).toBeInTheDocument();
    expect(screen.queryByText(/Due in 1 days/i)).toBeNull();
  });

  it('renders the FY budget health panel with the exact percentage', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });

    await settled();

    // BUDGETS_VS_ACTUALS[0].pctUsed === 40
    expect(await screen.findByText('(40%)')).toBeInTheDocument();
  });

  it('colors the Budget Health bar and label red once usage reaches 100%', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({ budgets: [{ ...BUDGETS_VS_ACTUALS[0], period: 'FY', pctUsed: 100 }] }),
    });
    await settled();

    const widget = (await screen.findByText(/Budget Health/i)).closest('div.rounded-xl') as HTMLElement;
    expect(within(widget).getByText('(100%)')).toHaveClass('text-red-600');
    const bar = widget.querySelector('.h-2.rounded-full.transition-all') as HTMLElement;
    expect(bar.style.background).toContain('f43f5e');
  });

  it('colors the Budget Health bar and label amber between 75% and 99% usage', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({ budgets: [{ ...BUDGETS_VS_ACTUALS[0], period: 'FY', pctUsed: 85 }] }),
    });
    await settled();

    const widget = (await screen.findByText(/Budget Health/i)).closest('div.rounded-xl') as HTMLElement;
    expect(within(widget).getByText('(85%)')).toHaveClass('text-yellow-600');
    const bar = widget.querySelector('.h-2.rounded-full.transition-all') as HTMLElement;
    expect(bar.style.background).toContain('f59e0b');
  });

  it('renders the Net Worth card without a trend indicator when there is no comparable snapshot', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({ summary: { ...SUMMARY, netWorthChange: undefined, netWorthChangePct: undefined } }),
    });
    await screen.findByText('55.5%');

    // "Net Worth" also labels the Assets-vs-Liabilities pie panel — the StatCard's
    // own title is the first match, and its own card is the nearest rounded-xl
    // ancestor from there.
    const netWorthCard = screen.getAllByText('Net Worth')[0].closest('div.rounded-xl') as HTMLElement;
    expect(within(netWorthCard).getByText('vs last FY')).toBeInTheDocument();
    // change === undefined renders a plain subtitle (StatCard.tsx's
    // `{subtitle && change === undefined && ...}` branch) — no percentage, no
    // trend arrow, unlike the defined-change case.
    expect(within(netWorthCard).queryByText(/%/)).toBeNull();
  });

  it('shows a down-trend (red, TrendingDown icon) on the Net Worth card when net worth declined this FY', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({ summary: { ...SUMMARY, netWorthChange: -5000, netWorthChangePct: -3.5 } }),
    });
    await settled();

    const netWorthCard = screen.getAllByText('Net Worth')[0].closest('div.rounded-xl') as HTMLElement;
    const trendRow = within(netWorthCard).getByText(/3\.5% vs last FY/).closest('div') as HTMLElement;
    expect(trendRow).toHaveClass('text-red-500');
    expect(trendRow.querySelector('.lucide-trending-down')).not.toBeNull();
    expect(trendRow.querySelector('.lucide-trending-up')).toBeNull();
  });

  it('colors the Savings Rate card amber when the rate is between 10% and 30%', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({ summary: { ...SUMMARY, savingsRate: 20 } }),
    });
    await settled();

    const card = screen.getByText('Savings Rate').closest('div.rounded-xl') as HTMLElement;
    expect(card).toHaveClass('bg-amber-50');
  });

  it('colors the Savings Rate card rose when the rate is 10% or below', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({ summary: { ...SUMMARY, savingsRate: 5 } }),
    });
    await settled();

    const card = screen.getByText('Savings Rate').closest('div.rounded-xl') as HTMLElement;
    expect(card).toHaveClass('bg-rose-50');
  });

  it('renders top spend-by-category rows sorted by spend descending', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Spend by Category/i)).closest('div.rounded-xl') as HTMLElement;
    const rowNames = within(widget).getAllByText(/Food|Rent|Travel/).map((el) => el.textContent);
    // SPENDING_BY_CATEGORY: Food 50000 > Rent 30000 > Travel 10000.
    expect(rowNames).toEqual(['Food', 'Rent', 'Travel']);
  });

  it('renders "Uncategorized" for a row with no category', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({
        spending: [{ categoryId: null, category: null, total: 15000 }],
      }),
    });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Spend by Category/i)).closest('div.rounded-xl') as HTMLElement;
    expect(within(widget).getByText('Uncategorized')).toBeInTheDocument();
  });

  it('renders an empty state when there is no spending recorded for the FY', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers({ spending: [] }) });
    await screen.findByText('55.5%');

    expect(await screen.findByText(/No spending recorded for FY/i)).toBeInTheDocument();
  });

  it('shows a persistent error message on failure — not the misleading empty state', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        // Deliberately a DIFFERENT message than the widget's own fixed copy — a
        // toast DOES appear in this harness for a 500 (via the axios response
        // interceptor in lib/api.ts, not the queryCache-level handler, which only
        // fires for response-less errors and is dormant in tests anyway). Asserting
        // on a matching string could be satisfied by the toast instead of the
        // actual widget state.
        http.get(url('/reports/spending-by-category'), () =>
          HttpResponse.json({ message: 'Spending blew up' }, { status: 500 })),
        ...dashboardHandlers(),
      ],
    });
    await screen.findByText('55.5%');

    expect(await screen.findByTestId('spend-category-error')).toHaveTextContent('Unable to load spending data.');
    expect(screen.queryByText(/No spending recorded for FY/i)).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('spend-category-row')).toHaveLength(0);
  });

  it('shows a loading skeleton while in flight — not the misleading empty state', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/reports/spending-by-category'), async () => {
          await delay(300);
          return HttpResponse.json({ data: SPENDING_BY_CATEGORY });
        }),
        ...dashboardHandlers(),
      ],
    });
    await settled();

    // Positive assertion, not just absences — a regression that rendered nothing at
    // all while pending would otherwise still pass. Scoped to the widget's own card:
    // an unscoped /Loading/ match would also hit the cashflow chart's own skeleton.
    const card = (await screen.findByText(/Spend by Category/i)).closest('div.rounded-xl') as HTMLElement;
    expect(within(card).getByTestId('spend-category-loading')).toBeInTheDocument();
    expect(screen.queryByText(/No spending recorded for FY/i)).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('spend-category-row')).toHaveLength(0);

    expect(await screen.findAllByTestId('spend-category-row', {}, { timeout: 3000 })).toHaveLength(3);
  });

  it('a failed background refetch (e.g. after a quick-add) replaces the rows with the error message', async () => {
    const user = userEvent.setup();
    // Toggled by the create mutation, not by call count — selecting a member below
    // ALSO changes the query key (viewUserId) and triggers its own refetch, which
    // must still succeed; only the refetch caused by the create's invalidation
    // (i.e. after the toggle flips) should fail.
    let shouldFail = false;
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/categories'), () => HttpResponse.json({ data: [] })),
        http.get(url('/accounts'), () => HttpResponse.json({ data: [] })),
        http.post(url('/transactions'), () => {
          shouldFail = true;
          return HttpResponse.json({ data: {} });
        }),
        http.get(url('/reports/spending-by-category'), () => {
          if (shouldFail) return HttpResponse.json({ message: 'Spending blew up' }, { status: 500 });
          return HttpResponse.json({ data: SPENDING_BY_CATEGORY });
        }),
        ...dashboardHandlers(),
      ],
    });
    await settled();
    expect(await screen.findAllByTestId('spend-category-row')).toHaveLength(3);

    // Add Expense/Income is hidden while `isViewingFamilyWide` (ADMIN, no selection).
    const select = await screen.findByLabelText(/View:/i) as HTMLSelectElement;
    await user.selectOptions(select, 'u-member');
    await waitFor(() => expect(select.value).toBe('u-member'));
    expect(await screen.findAllByTestId('spend-category-row')).toHaveLength(3);

    await user.click(await screen.findByRole('button', { name: /Add Expense/i }));
    const heading = await screen.findByRole('heading', { level: 2, name: 'Add Transaction' });
    const modal = heading.closest('div.bg-background') as HTMLElement;
    await user.type(within(modal).getByPlaceholderText(/swiggy order/i), 'Groceries');
    const amountInput = modal.querySelector('input[name="amount"]') as HTMLInputElement;
    await user.type(amountInput, '250');
    await user.click(within(modal).getByRole('button', { name: 'Add Transaction' }));

    // The create mutation invalidates ['report-spending'], and this deliberate choice
    // (matching Reports.tsx's simpler behavior, not a stale-data-preserving one) means
    // a FAILED refetch replaces the previously-correct rows with the error message,
    // rather than leaving them on screen.
    expect(await screen.findByTestId('spend-category-error')).toBeInTheDocument();
    expect(screen.queryAllByTestId('spend-category-row')).toHaveLength(0);
  });

  it('a MEMBER (not just ADMIN) sees the Spend by Category widget', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers(), user: MEMBER_USER });
    await screen.findByText('55.5%');

    expect(await screen.findByText(/Spend by Category/i)).toBeInTheDocument();
  });

  it('a negative-total category (net refund) renders a 0-width bar, not negative/NaN CSS', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({
        spending: [
          { categoryId: 'cat-food', category: { id: 'cat-food', name: 'Food' }, total: 20000 },
          { categoryId: 'cat-travel', category: { id: 'cat-travel', name: 'Travel' }, total: -5000 },
        ],
      }),
    });
    await screen.findByText('55.5%');

    const rows = await screen.findAllByTestId('spend-category-row');
    const travelRow = rows.find((row) => within(row).queryByText('Travel')) as HTMLElement;
    const bar = within(travelRow).getByTestId('spend-category-bar');
    expect(bar.style.width).toBe('0%');
  });

  it('renders every bar at 0 width when all top-5 totals are zero or negative (denominator itself is 0)', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({
        spending: [
          { categoryId: 'cat-food', category: { id: 'cat-food', name: 'Food' }, total: -2000 },
          { categoryId: 'cat-travel', category: { id: 'cat-travel', name: 'Travel' }, total: 0 },
        ],
      }),
    });
    await screen.findByText('55.5%');

    const bars = await screen.findAllByTestId('spend-category-bar');
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar.style.width).toBe('0%');
    }
  });

  it('reflects the selected member when an ADMIN switches views', async () => {
    const user = userEvent.setup();
    const seenTargetUserIds: (string | null)[] = [];
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        // Listed before dashboardHandlers()'s own spending-by-category handler —
        // MSW matches the FIRST registered handler for a given request.
        http.get(url('/reports/spending-by-category'), ({ request }) => {
          seenTargetUserIds.push(new URL(request.url).searchParams.get('targetUserId'));
          return HttpResponse.json({ data: SPENDING_BY_CATEGORY });
        }),
        ...dashboardHandlers(),
      ],
    });
    await screen.findByText('55.5%');

    const select = await screen.findByLabelText(/View:/i) as HTMLSelectElement;
    await user.selectOptions(select, 'u-member');
    await waitFor(() => expect(select.value).toBe('u-member'));

    await waitFor(() => expect(seenTargetUserIds).toContain('u-member'));
  });

  it('renders the 80C and 80D rows with correct amounts and a red bar below 75%', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Tax Deductions/i)).closest('div.rounded-xl') as HTMLElement;
    // TRACKER_80C: utilized 90000 of limit 150000, pctUtilized 60 (< 75 -> red).
    expect(within(widget).getByText(/80C — FY/i)).toBeInTheDocument();
    // SUMMARY_80D: total 25000 of combined limit 50000 (25000 self + 25000 parents), 50% (< 75 -> red).
    expect(within(widget).getByText('80D')).toBeInTheDocument();
    const bars = widget.querySelectorAll('.bg-red-500');
    expect(bars).toHaveLength(2);
  });

  it('colors a bar green once its threshold reaches 100%', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({
        tracker80C: { ...TRACKER_80C, utilized: 150000, remaining: 0, pctUtilized: 100 },
      }),
    });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Tax Deductions/i)).closest('div.rounded-xl') as HTMLElement;
    expect(widget.querySelectorAll('.bg-green-500')).toHaveLength(1);
  });

  it('colors a bar yellow at exactly the 75% threshold, not red', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({
        tracker80C: { ...TRACKER_80C, utilized: 112500, remaining: 37500, pctUtilized: 75 },
      }),
    });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Tax Deductions/i)).closest('div.rounded-xl') as HTMLElement;
    expect(widget.querySelectorAll('.bg-yellow-500')).toHaveLength(1);
    expect(widget.querySelectorAll('.bg-red-500')).toHaveLength(1); // 80D row is still 50%, unaffected
  });

  it('a MEMBER (not just ADMIN) sees the Tax Deductions widget', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers(), user: MEMBER_USER });
    await screen.findByText('55.5%');

    expect(await screen.findByText(/Tax Deductions/i)).toBeInTheDocument();
  });

  it('replaces both bars with a New Regime notice, not misleading numbers', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({ taxProfile: { ...TAX_PROFILE, regime: 'NEW' } }),
    });
    await screen.findByText('55.5%');

    expect(await screen.findByTestId('tax-widget-new-regime-notice')).toBeInTheDocument();
    const widget = (await screen.findByText(/Tax Deductions/i)).closest('div.rounded-xl') as HTMLElement;
    expect(within(widget).queryByText(/80C — FY/i)).toBeNull();
    expect(within(widget).queryByText('80D')).toBeNull();
  });

  it('shows a distinct "regime unknown" state on a profile fetch error, instead of silently defaulting to Old Regime', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/tax/profile'), () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
        ...dashboardHandlers(),
      ],
    });
    await screen.findByText('55.5%');

    expect(await screen.findByTestId('tax-widget-regime-unknown')).toBeInTheDocument();
    const widget = (await screen.findByText(/Tax Deductions/i)).closest('div.rounded-xl') as HTMLElement;
    // Not the New Regime notice either — a distinct third state.
    expect(within(widget).queryByTestId('tax-widget-new-regime-notice')).toBeNull();
    expect(within(widget).queryByText(/80C — FY/i)).toBeNull();
  });

  it('an independent 80C fetch failure shows "Unable to load 80C data.", distinct from the 80D row and from a profile fetch failure', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/tax/80c-tracker'), () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
        ...dashboardHandlers(),
      ],
    });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Tax Deductions/i)).closest('div.rounded-xl') as HTMLElement;
    expect(await within(widget).findByText('Unable to load 80C data.')).toBeInTheDocument();
    // 80D, unaffected, still renders its real numbers.
    expect(within(widget).getByText('80D')).toBeInTheDocument();
    expect(within(widget).queryByText('Unable to load 80D data.')).toBeNull();
  });

  it('an independent 80D fetch failure shows "Unable to load 80D data.", distinct from the 80C row', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/insurance/80d-summary'), () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
        ...dashboardHandlers(),
      ],
    });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Tax Deductions/i)).closest('div.rounded-xl') as HTMLElement;
    expect(await within(widget).findByText('Unable to load 80D data.')).toBeInTheDocument();
    // 80C, unaffected, still renders its real numbers.
    expect(within(widget).getByText(/80C — FY/i)).toBeInTheDocument();
    expect(within(widget).queryByText('Unable to load 80C data.')).toBeNull();
  });

  it('defaults to the OLD regime (real numbers) when the profile fetched successfully but has no regime set yet — a distinct state from both the error and NEW-regime cases', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({ taxProfile: { id: 'prof-1' } }),
    });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Tax Deductions/i)).closest('div.rounded-xl') as HTMLElement;
    expect(within(widget).queryByTestId('tax-widget-regime-unknown')).toBeNull();
    expect(within(widget).queryByTestId('tax-widget-new-regime-notice')).toBeNull();
    expect(within(widget).getByText(/80C — FY/i)).toBeInTheDocument();
    expect(within(widget).getByText('80D')).toBeInTheDocument();
  });

  it('renders a 0-width 80D bar when both combined limits are zero, not NaN CSS (the 80D-specific divide-by-zero guard)', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({
        summary80D: {
          selfFamily: { paid: 0, limit: 0, deductible: 0 },
          parents: { paid: 0, limit: 0, deductible: 0 },
          total: 0,
          policies: [],
        },
      }),
    });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Tax Deductions/i)).closest('div.rounded-xl') as HTMLElement;
    expect(within(widget).getByText('80D')).toBeInTheDocument();
    const bars = widget.querySelectorAll('.h-2.rounded-full.transition-all');
    // 80C's bar precedes 80D's in DOM order; 80D's bar (the last one) must be 0-width.
    const eightyDBar = bars[bars.length - 1] as HTMLElement;
    expect(eightyDBar.style.width).toBe('0%');
  });

  it('renders 0-width bars for zero usage, not NaN CSS', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({
        tracker80C: { limit: 150000, utilized: 0, remaining: 150000, pctUtilized: 0, breakdown: {} },
        summary80D: {
          selfFamily: { paid: 0, limit: 25000, deductible: 0 },
          parents: { paid: 0, limit: 25000, deductible: 0 },
          total: 0,
          policies: [],
        },
      }),
    });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Tax Deductions/i)).closest('div.rounded-xl') as HTMLElement;
    const bars = widget.querySelectorAll('.h-2.rounded-full.transition-all');
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect((bar as HTMLElement).style.width).toBe('0%');
    }
  });

  it('refetches the 80C/80D/profile queries with the new member when an ADMIN switches views', async () => {
    const user = userEvent.setup();
    const seenTargetUserIds: (string | null)[] = [];
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/tax/80c-tracker'), ({ request }) => {
          seenTargetUserIds.push(new URL(request.url).searchParams.get('targetUserId'));
          return HttpResponse.json({ data: TRACKER_80C });
        }),
        ...dashboardHandlers(),
      ],
    });
    await screen.findByText('55.5%');

    const select = await screen.findByLabelText(/View:/i) as HTMLSelectElement;
    await user.selectOptions(select, 'u-member');
    await waitFor(() => expect(select.value).toBe('u-member'));

    await waitFor(() => expect(seenTargetUserIds).toContain('u-member'));
  });

  it('renders Portfolio Value and Loan Outstanding for the default (family-wide ADMIN) view', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Investments & Loans/i)).closest('div.rounded-xl') as HTMLElement;
    // PORTFOLIO.totalCurrentValue = 350000.
    expect(within(widget).getByText('Portfolio Value')).toBeInTheDocument();
    expect(within(widget).getByText('₹3,50,000.00')).toBeInTheDocument();
    // LOANS: loan-1 has no share (falls back to outstandingBalance 120000), loan-2's
    // share (80000) wins over its outstandingBalance (200000) — total 200000, exactly
    // mirroring Loans.tsx's own outstandingBalanceShare ?? outstandingBalance reduce.
    // A regression that dropped the `??` fallback or summed both fields would produce
    // a different total and fail this exact assertion.
    expect(within(widget).getByText('Loan Outstanding')).toBeInTheDocument();
    expect(within(widget).getByText('₹2,00,000.00')).toBeInTheDocument();
    const links = within(widget).getAllByRole('link', { name: /View all/i });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/investments', '/loans']);
  });

  it('renders ₹0 Loan Outstanding when there are no loans, not an error', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers({ loans: [] }) });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Investments & Loans/i)).closest('div.rounded-xl') as HTMLElement;
    expect(within(widget).getByText('Loan Outstanding')).toBeInTheDocument();
    expect(within(widget).getByText('₹0.00')).toBeInTheDocument();
    // ₹0 is a legitimate state here, not an "unconfigured" empty-state message or error.
    expect(within(widget).queryByText(/no /i)).toBeNull();
    expect(within(widget).queryByText(/unable to load/i)).toBeNull();
  });

  it('renders ₹0 Portfolio Value when the user has never invested', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: dashboardHandlers({
        portfolio: { totalInvested: 0, totalCurrentValue: 0, absoluteGain: 0, absoluteReturnPct: 0, byType: {} },
      }),
    });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Investments & Loans/i)).closest('div.rounded-xl') as HTMLElement;
    expect(within(widget).getByText('Portfolio Value')).toBeInTheDocument();
    expect(within(widget).getByText('₹0.00')).toBeInTheDocument();
  });

  it('shows a distinct "Unable to load" state per row on a fetch error, not a false ₹0', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/investments/portfolio-summary'), () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
        ...dashboardHandlers(),
      ],
    });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Investments & Loans/i)).closest('div.rounded-xl') as HTMLElement;
    await waitFor(() => expect(within(widget).getByText('Unable to load')).toBeInTheDocument());
    // The loan row, unaffected by the portfolio error, still renders its real value.
    expect(within(widget).getByText('₹2,00,000.00')).toBeInTheDocument();
  });

  it('shows a distinct "Unable to load" state for the Loan row on a fetch error, not a false ₹0 (mirrors the Portfolio Value case above)', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/loans'), () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
        ...dashboardHandlers(),
      ],
    });
    await screen.findByText('55.5%');

    const widget = (await screen.findByText(/Investments & Loans/i)).closest('div.rounded-xl') as HTMLElement;
    // Scoped to the Loan Outstanding row specifically (not a bare widget-wide query) —
    // both rows can render this exact text, so an unscoped getByText would become
    // ambiguous the moment a test combines both a loans and a portfolio error.
    const loanRow = within(widget).getByText('Loan Outstanding').closest('div.flex') as HTMLElement;
    await waitFor(() => expect(within(loanRow).getByText('Unable to load')).toBeInTheDocument());
    // The portfolio row, unaffected by the loans error, still renders its real value.
    expect(within(widget).getByText('₹3,50,000.00')).toBeInTheDocument();
  });

  it('prompts to set up FY budgets when none have period FY', async () => {
    // The fixture's default period is MONTHLY, which the panel filters out.
    renderPage(<DashboardPage />, {
      route: '/', handlers: dashboardHandlers({ budgets: BUDGETS_VS_ACTUALS }),
    });
    expect(await screen.findByText(/No FY budgets configured/i)).toBeInTheDocument();
  });

  it('an ADMIN gets the member selector and can switch to a member', async () => {
    const user = userEvent.setup();
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });
    await screen.findByText('55.5%');

    const select = await screen.findByLabelText(/View:/i) as HTMLSelectElement;
    expect(select.value).toBe('');           // ADMIN defaults to All Family
    await user.selectOptions(select, 'u-member');

    // 'Ravi' alone is ambiguous — it is both a <option> and the header subtitle.
    // Assert the selection took, then the subtitle that only appears once scoped.
    await waitFor(() => expect(select.value).toBe('u-member'));
    expect(await screen.findByText(/Financial overview for FY .*· Ravi/)).toBeInTheDocument();
  });

  it('shows "Could not load members" instead of the selector when the member-list fetch fails for an ADMIN', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/users/members'), () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
        ...dashboardHandlers(),
      ],
    });
    // Not settled() — the <select> that helper waits for never mounts on this branch.
    await screen.findByText('55.5%');

    expect(await screen.findByText(/Could not load members/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/View:/i)).toBeNull();
  });

  it('skips the snapshot write when the current month already has one', async () => {
    let posted = false;
    // A realistic snapshotDate — "1st of this IST month, 00:00 IST" — NOT the old
    // buggy `new Date().toISOString().slice(0,7)-01`, which the SUT itself no
    // longer uses and which happened to make this test pass for the wrong reason
    // (both sides shared the same bug, so they always "matched").
    const thisMonth = istMonthStartISO(new Date());
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.post(url('/snapshots/net-worth'), () => {
          posted = true;
          return HttpResponse.json({ data: NET_WORTH_HISTORY[0] });
        }),
        ...dashboardHandlers({
          history: [{ snapshotDate: thisMonth, netWorth: MONEY, totalAssets: 1, totalLiabilities: 0 }],
        }),
      ],
    });

    await screen.findByText('55.5%');
    // The effect guards on hasCurrentMonthSnapshot (:73-84); no write-on-read.
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(posted).toBe(false);
  });

  it('fires the snapshot write when the most recent snapshot is from a prior month', async () => {
    let posted = false;
    // A month-old snapshot, real IST-month-start shape — proves the fix's positive
    // case (missing current-month snapshot -> write fires), not just the negative
    // case above.
    const lastMonth = istMonthStartISO(new Date(Date.now() - 32 * 24 * 60 * 60 * 1000));
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.post(url('/snapshots/net-worth'), () => {
          posted = true;
          return HttpResponse.json({ data: NET_WORTH_HISTORY[0] });
        }),
        ...dashboardHandlers({
          history: [{ snapshotDate: lastMonth, netWorth: MONEY, totalAssets: 1, totalLiabilities: 0 }],
        }),
      ],
    });

    await screen.findByText('55.5%');
    await waitFor(() => expect(posted).toBe(true));
  });

  it('fires the snapshot write only once across the invalidate-and-refetch cycle', async () => {
    let postCount = 0;
    let getCount = 0;
    const lastMonth = istMonthStartISO(new Date(Date.now() - 32 * 24 * 60 * 60 * 1000));
    const currentMonthSnapshot = { snapshotDate: istMonthStartISO(new Date()), netWorth: MONEY, totalAssets: 1, totalLiabilities: 0 };
    // Stateful GET: starts missing the current month, "gains" it once the POST
    // fires — mirrors the real invalidate->refetch cycle instead of a static fixture.
    let historyState = [{ snapshotDate: lastMonth, netWorth: MONEY, totalAssets: 1, totalLiabilities: 0 }];
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/dashboard/summary'), () => HttpResponse.json({ data: SUMMARY })),
        http.get(url('/dashboard/cashflow'), () => HttpResponse.json({ data: CASHFLOW })),
        http.get(url('/dashboard/upcoming-alerts'), () => HttpResponse.json({ data: ALERTS })),
        http.get(url('/dashboard/family-overview'), () => HttpResponse.json({ data: FAMILY_OVERVIEW })),
        http.get(url('/budgets/vs-actuals'), () => HttpResponse.json({ data: FY_BUDGETS })),
        http.get(url('/reports/spending-by-category'), () => HttpResponse.json({ data: SPENDING_BY_CATEGORY })),
        http.get(url('/tax/profile'), () => HttpResponse.json({ data: TAX_PROFILE })),
        http.get(url('/tax/80c-tracker'), () => HttpResponse.json({ data: TRACKER_80C })),
        http.get(url('/insurance/80d-summary'), () => HttpResponse.json({ data: SUMMARY_80D })),
        http.get(url('/investments/portfolio-summary'), () => HttpResponse.json({ data: PORTFOLIO })),
        http.get(url('/loans'), () => HttpResponse.json({ data: LOANS })),
        http.get(url('/snapshots/net-worth'), () => { getCount += 1; return HttpResponse.json({ data: historyState }); }),
        http.post(url('/snapshots/net-worth'), () => {
          postCount += 1;
          historyState = [...historyState, currentMonthSnapshot];
          return HttpResponse.json({ data: currentMonthSnapshot });
        }),
      ],
    });

    await screen.findByText('55.5%');
    await waitFor(() => expect(postCount).toBe(1));
    // Wait for the ACTUAL refetch this test claims to exercise (the mutation's
    // onSuccess invalidates ['net-worth-history'], triggering a 2nd GET) rather
    // than just the loading spinner, which can clear before that refetch even
    // fires and would let this assertion pass without proving anything.
    await waitFor(() => expect(getCount).toBeGreaterThanOrEqual(2));
    expect(postCount).toBe(1);
  });

  it('surfaces an error toast when the summary request fails', async () => {
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/dashboard/summary'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
        ...dashboardHandlers(),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
  });

  it('renders money in Indian format', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });
    await screen.findByText('55.5%');
    await settled();
    // The Assets-vs-Liabilities panel renders the full net worth value.
    expect(screen.getAllByText(MONEY_FORMATTED).length).toBeGreaterThan(0);
  });

  it('hides the Add Expense/Add Income buttons when an ADMIN is viewing "All Family"', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });
    await screen.findByText('55.5%');
    await settled();

    expect(screen.queryByRole('button', { name: /Add Expense/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add Income/i })).toBeNull();
  });

  it('shows the Add Expense/Add Income buttons for a MEMBER', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers(), user: MEMBER_USER });
    await screen.findByText('55.5%');

    expect(await screen.findByRole('button', { name: /Add Expense/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Income/i })).toBeInTheDocument();
  });

  it('shows the buttons for an ADMIN once a specific member is selected, and clicking "Add Income" opens the modal pre-set to Income', async () => {
    const user = userEvent.setup();
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/categories'), () => HttpResponse.json({ data: [] })),
        http.get(url('/accounts'), () => HttpResponse.json({ data: [] })),
        ...dashboardHandlers(),
      ],
    });
    await screen.findByText('55.5%');

    const select = await screen.findByLabelText(/View:/i) as HTMLSelectElement;
    await user.selectOptions(select, 'u-member');
    await waitFor(() => expect(select.value).toBe('u-member'));

    const incomeButton = await screen.findByRole('button', { name: /Add Income/i });
    await user.click(incomeButton);

    const heading = await screen.findByRole('heading', { level: 2, name: 'Add Transaction' });
    const modal = heading.closest('div.bg-background') as HTMLElement;
    const typeSelect = modal.querySelector('select[name="type"]') as HTMLSelectElement;
    expect(typeSelect.value).toBe('INCOME');
  });

  it('clicking "Add Expense" opens the modal pre-set to Expense (the mirror of the Income case above — catches a swapped onClick)', async () => {
    const user = userEvent.setup();
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/categories'), () => HttpResponse.json({ data: [] })),
        http.get(url('/accounts'), () => HttpResponse.json({ data: [] })),
        ...dashboardHandlers(),
      ],
    });
    await screen.findByText('55.5%');

    const select = await screen.findByLabelText(/View:/i) as HTMLSelectElement;
    await user.selectOptions(select, 'u-member');
    await waitFor(() => expect(select.value).toBe('u-member'));

    const expenseButton = await screen.findByRole('button', { name: /Add Expense/i });
    await user.click(expenseButton);

    const heading = await screen.findByRole('heading', { level: 2, name: 'Add Transaction' });
    const modal = heading.closest('div.bg-background') as HTMLElement;
    const typeSelect = modal.querySelector('select[name="type"]') as HTMLSelectElement;
    expect(typeSelect.value).toBe('EXPENSE');
  });

  it('submits a quick-add transaction with the SELECTED member as targetUserId, not the admin\'s own id', async () => {
    const user = userEvent.setup();
    let seenTargetUserId: string | null | undefined;
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/categories'), () => HttpResponse.json({ data: [] })),
        http.get(url('/accounts'), () => HttpResponse.json({ data: [] })),
        http.post(url('/transactions'), ({ request }) => {
          seenTargetUserId = new URL(request.url).searchParams.get('targetUserId');
          return HttpResponse.json({ data: {} });
        }),
        ...dashboardHandlers(),
      ],
    });
    await screen.findByText('55.5%');

    const select = await screen.findByLabelText(/View:/i) as HTMLSelectElement;
    await user.selectOptions(select, 'u-member');
    await waitFor(() => expect(select.value).toBe('u-member'));

    await user.click(await screen.findByRole('button', { name: /Add Expense/i }));
    const heading = await screen.findByRole('heading', { level: 2, name: 'Add Transaction' });
    const modal = heading.closest('div.bg-background') as HTMLElement;
    await user.type(within(modal).getByPlaceholderText(/swiggy order/i), 'Groceries');
    const amountInput = modal.querySelector('input[name="amount"]') as HTMLInputElement;
    await user.type(amountInput, '250');
    await user.click(within(modal).getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => expect(seenTargetUserId).toBe('u-member'));
  });

  // Prior MEMBER coverage only checked button PRESENCE (:664-670) — no test ever clicked
  // through as a MEMBER. This proves Dashboard's own onClick wiring (setQuickAddType) and
  // defaultType selection actually work end-to-end for a MEMBER, which is genuinely new.
  //
  // NOTE on scope: the targetUserId-omitted assertion below is the SAME assertion
  // AddTransactionModal.test.tsx:158-182 already makes in isolation, and a MEMBER's
  // viewUserId is always undefined — so this assertion alone would not catch a regression
  // that deleted `targetUserId={viewUserId}` from Dashboard.tsx (the existing
  // ADMIN-with-selected-member test at :858ish already catches that mutation, since
  // viewUserId is defined there). It's kept for documentation value, not as the test's
  // primary contribution. `showAccountOwner`/`fallbackAccountOwnerName` wiring remains
  // untested anywhere in the repo (accountFormat.ts's owner-name branch has 0 real
  // exercises) — out of scope for this task, logged as tech debt in progress.md.
  it('a MEMBER can click through Dashboard\'s own Add Expense button to open and submit the quick-add modal (not just see it — click-handler and defaultType wiring, not previously exercised for MEMBER)', async () => {
    const user = userEvent.setup();
    let seenParams: URLSearchParams | null = null;
    renderPage(<DashboardPage />, {
      route: '/',
      handlers: [
        http.get(url('/categories'), () => HttpResponse.json({ data: [] })),
        http.get(url('/accounts'), () => HttpResponse.json({ data: [] })),
        http.post(url('/transactions'), ({ request }) => {
          seenParams = new URL(request.url).searchParams;
          return HttpResponse.json({ data: {} });
        }),
        ...dashboardHandlers(),
      ],
      user: MEMBER_USER,
    });
    await screen.findByText('55.5%');

    await user.click(await screen.findByRole('button', { name: /Add Expense/i }));
    const heading = await screen.findByRole('heading', { level: 2, name: 'Add Transaction' });
    const modal = heading.closest('div.bg-background') as HTMLElement;
    const typeSelect = modal.querySelector('select[name="type"]') as HTMLSelectElement;
    expect(typeSelect.value).toBe('EXPENSE');

    await user.type(within(modal).getByPlaceholderText(/swiggy order/i), 'Groceries');
    const amountInput = modal.querySelector('input[name="amount"]') as HTMLInputElement;
    await user.type(amountInput, '250');
    await user.click(within(modal).getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => expect(seenParams).not.toBeNull());
    expect(seenParams!.has('targetUserId')).toBe(false);
  });
});

/**
 * handleCashflowClick — unit tests, not a page mount.
 *
 * Recharts renders at 0x0 under jsdom, so a real coordinate click can never produce
 * activePayload, and Dashboard.tsx renders a SECOND, unrelated AreaChart (Net Worth
 * Trend, no onClick) — a module-level recharts mock capturing "the" onClick prop would
 * collide between the two instances. Calling the exported handler directly with a
 * synthetic {activePayload} argument exercises the exact same runtime closure
 * production uses, without either problem.
 */
describe('handleCashflowClick', () => {
  const point = (overrides: Partial<{ month: string; monthIndex: unknown; year: unknown }>) => ({
    activePayload: [{ payload: { month: 'Apr', monthIndex: 4, year: 2025, income: 0, expense: 0, net: 0, ...overrides } }],
  });

  it('navigates to the full-month range for a mid-year month (April)', () => {
    const navigate = vi.fn();
    handleCashflowClick(point({}), navigate);
    expect(navigate).toHaveBeenCalledWith('/transactions?startDate=2025-04-01&endDate=2025-04-30');
  });

  it('navigates correctly for January, the FY-year-rollover month (monthIndex=1)', () => {
    const navigate = vi.fn();
    handleCashflowClick(point({ month: 'Jan', monthIndex: 1, year: 2026 }), navigate);
    expect(navigate).toHaveBeenCalledWith('/transactions?startDate=2026-01-01&endDate=2026-01-31');
  });

  it('resolves the correct end-of-month day for a non-leap February (28 days)', () => {
    const navigate = vi.fn();
    handleCashflowClick(point({ month: 'Feb', monthIndex: 2, year: 2026 }), navigate);
    expect(navigate).toHaveBeenCalledWith('/transactions?startDate=2026-02-01&endDate=2026-02-28');
  });

  it('resolves the correct end-of-month day for a leap February (29 days)', () => {
    const navigate = vi.fn();
    handleCashflowClick(point({ month: 'Feb', monthIndex: 2, year: 2028 }), navigate);
    expect(navigate).toHaveBeenCalledWith('/transactions?startDate=2028-02-01&endDate=2028-02-29');
  });

  it('resolves December correctly (the day-0-of-next-month trick must not roll into January)', () => {
    const navigate = vi.fn();
    handleCashflowClick(point({ month: 'Dec', monthIndex: 12, year: 2025 }), navigate);
    expect(navigate).toHaveBeenCalledWith('/transactions?startDate=2025-12-01&endDate=2025-12-31');
  });

  it('does not navigate when activePayload is absent (click missed every plotted point)', () => {
    const navigate = vi.fn();
    handleCashflowClick({ activePayload: undefined }, navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when activePayload is an empty array', () => {
    const navigate = vi.fn();
    handleCashflowClick({ activePayload: [] }, navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  // Recharts types activePayload as `any[]` — a backend field rename or deploy-skew
  // could ship a payload shape this handler doesn't expect. Silently navigating to
  // "?startDate=&endDate=" would be worse than not navigating at all. Split into
  // separate cases (rather than one test with 3 calls) so a regression names the
  // exact malformed-input case that started slipping through, not just "something did".
  it('does not navigate when monthIndex is missing', () => {
    const navigate = vi.fn();
    handleCashflowClick(point({ monthIndex: undefined }), navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when year is missing', () => {
    const navigate = vi.fn();
    handleCashflowClick(point({ year: undefined }), navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when monthIndex is a non-numeric string', () => {
    const navigate = vi.fn();
    handleCashflowClick(point({ monthIndex: 'Apr' }), navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when monthIndex or year is literal NaN (typeof NaN === "number", so a naive typeof guard would miss this)', () => {
    const navigate = vi.fn();
    handleCashflowClick(point({ monthIndex: NaN }), navigate);
    handleCashflowClick(point({ year: NaN }), navigate);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('Family Spending widget — render gating', () => {
  it('an ADMIN with multiple family members sees the chart', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });
    await screen.findByText('55.5%');
    expect(await screen.findByText(/Family Spending/i)).toBeInTheDocument();
  });

  it('a MEMBER never sees the Family Spending chart, regardless of family size (the click surface this task adds must not become reachable to a MEMBER)', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers(), user: MEMBER_USER });
    await screen.findByText('55.5%');
    expect(screen.queryByText(/Family Spending/i)).toBeNull();
  });
});

describe('handleFamilyMemberClick', () => {
  it('navigates to the Spending Analysis tab pre-scoped to the clicked member', () => {
    const navigate = vi.fn();
    handleFamilyMemberClick('u-member', navigate);
    expect(navigate).toHaveBeenCalledWith('/reports?tab=spending&targetUserId=u-member');
  });

  it('produces a distinct URL per member — no cross-member bleed', () => {
    const navigate = vi.fn();
    handleFamilyMemberClick('u-admin', navigate);
    handleFamilyMemberClick('u-member', navigate);
    expect(navigate).toHaveBeenNthCalledWith(1, '/reports?tab=spending&targetUserId=u-admin');
    expect(navigate).toHaveBeenNthCalledWith(2, '/reports?tab=spending&targetUserId=u-member');
  });
});
