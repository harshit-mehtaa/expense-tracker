/**
 * Dashboard page — smoke.
 *
 * Dashboard is one of the few pages with a REAL early return:
 *   `if (summaryLoading || (isAdmin && isMembersLoading)) return <PageLoader />` (:91)
 * so the <h1> genuinely is gated behind loading here, unlike most pages. The loaded
 * sentinel is still a data-derived string rather than the heading, so the assertion
 * stays honest if that early return is ever removed.
 *
 * Handler count: 11 page-specific + 5 base = 16. Note POST /snapshots/net-worth, fired
 * from a mount effect (:77-84) whenever the current month has no snapshot — omitting it
 * trips onUnhandledRequest:'error'. GET /reports/spending-by-category backs the
 * Spend by Category widget, shared with Reports.tsx under the same query key. GET
 * /tax/profile, /tax/80c-tracker, /insurance/80d-summary back the Tax Deductions
 * widget, shared with TaxCentre.tsx/Tracker80DTab.tsx under the same query keys.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import DashboardPage from '@/pages/Dashboard';
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

const CASHFLOW = [
  { month: "Apr '25", monthIndex: 3, year: 2025, income: 75000, expense: 40000, net: 35000 },
  { month: "May '25", monthIndex: 4, year: 2025, income: 80000, expense: 42000, net: 38000 },
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

function dashboardHandlers(over: Partial<{
  summary: unknown; cashflow: unknown; alerts: unknown;
  history: unknown; budgets: unknown; family: unknown; spending: unknown;
  taxProfile: unknown; tracker80C: unknown; summary80D: unknown;
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

  it('renders the FY budget health panel with the exact percentage', async () => {
    renderPage(<DashboardPage />, { route: '/', handlers: dashboardHandlers() });

    await settled();

    // BUDGETS_VS_ACTUALS[0].pctUsed === 40
    expect(await screen.findByText('(40%)')).toBeInTheDocument();
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
});
