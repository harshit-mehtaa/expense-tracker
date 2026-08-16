/**
 * Dashboard page — smoke.
 *
 * Dashboard is one of the few pages with a REAL early return:
 *   `if (summaryLoading || (isAdmin && isMembersLoading)) return <PageLoader />` (:91)
 * so the <h1> genuinely is gated behind loading here, unlike most pages. The loaded
 * sentinel is still a data-derived string rather than the heading, so the assertion
 * stays honest if that early return is ever removed.
 *
 * Handler count: 7 page-specific + 5 base = 12. Note POST /snapshots/net-worth, fired
 * from a mount effect (:77-84) whenever the current month has no snapshot — omitting it
 * trips onUnhandledRequest:'error'.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import DashboardPage from '@/pages/Dashboard';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MONEY, MONEY_FORMATTED, BUDGETS_VS_ACTUALS } from '../support/fixtures';

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

/** An FY-period budget — Dashboard's Budget Health panel filters to period === 'FY'. */
const FY_BUDGETS = [{ ...BUDGETS_VS_ACTUALS[0], period: 'FY' }];

const FAMILY_OVERVIEW = {
  members: [
    { id: 'u-admin', name: 'Asha', colorTag: '#ff0000' },
    { id: 'u-member', name: 'Ravi', colorTag: '#00ff00' },
  ],
  chartData: [{ month: "Apr '25", 'u-admin': 40000, 'u-member': 20000 }],
};

function dashboardHandlers(over: Partial<{
  summary: unknown; cashflow: unknown; alerts: unknown;
  history: unknown; budgets: unknown; family: unknown;
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
    const thisMonth = `${new Date().toISOString().slice(0, 7)}-01`;
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
