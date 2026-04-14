import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { useFY } from '@/contexts/FYContext';
import { fetchProfitAndLoss, fetchTrialBalance } from '@/api/dashboard';
import api from '@/lib/api';
import { formatINRShort } from '@/lib/indianFormat';
import { cn } from '@/lib/utils';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import {
  useChartGradients,
  CHART_PALETTE,
  CustomTooltip,
  AXIS_STYLE,
  GRID_STYLE,
} from '@/lib/chartUtils';

type TabId = 'pl' | 'spending' | 'networth' | 'trialbalance';

const LOAN_TYPE_LABELS: Record<string, string> = {
  HOME:     'Home Loan',
  AUTO:     'Car Loan',
  PERSONAL: 'Personal Loan',
  EDUCATION:'Education Loan',
  GOLD:     'Gold Loan',
  LAP:      'Loan Against Property',
  BUSINESS: 'Business Loan',
  OTHER:    'Other Loans',
};

const INVESTMENT_TYPE_LABELS: Record<string, string> = {
  STOCKS_INDIA:   'Stocks (India)',
  STOCKS_FOREIGN: 'Stocks (Foreign)',
  MUTUAL_FUND:    'Mutual Fund',
  ELSS:           'ELSS',
  PPF:            'PPF',
  NPS:            'NPS',
  EPF:            'EPF',
  SGB:            'SGB',
  GOLD_ETF:       'Gold ETF',
  BONDS:          'Bonds',
};

const GOLD_TYPE_LABELS: Record<string, string> = {
  PHYSICAL:  'Physical',
  SGB:       'SGB',
  GOLD_ETF:  'Gold ETF',
  DIGITAL:   'Digital',
};

export default function ReportsPage() {
  const { selectedFY } = useFY();
  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();
  const { gradIds, GradDefs } = useChartGradients();

  const [activeTab, setActiveTab] = useState<TabId>('pl');

  const tabs: { id: TabId; label: string }[] = [
    { id: 'pl', label: 'P&L' },
    { id: 'spending', label: 'Spending Analysis' },
    { id: 'networth', label: 'Net Worth' },
    { id: 'trialbalance', label: 'Trial Balance' },
  ];

  // ── P&L query (all users) ────────────────────────────────────────────────────
  const { data: plData, isLoading: isPnLLoading, isError: isPnLError, refetch: refetchPnL } = useQuery({
    queryKey: ['profit-and-loss', selectedFY, viewUserId],
    queryFn: () => fetchProfitAndLoss(selectedFY, isAdmin ? viewUserId : undefined),
  });

  // ── Spending-by-category query (all users, scoped to effectiveUserId) ─────────
  const { data: spendingByCat = [] } = useQuery({
    queryKey: ['report-spending', selectedFY, viewUserId],
    queryFn: () => {
      const params = new URLSearchParams({ fy: selectedFY });
      if (isAdmin && viewUserId) params.set('targetUserId', viewUserId);
      return api.get<{ data: any[] }>(`/reports/spending-by-category?${params}`).then((r) => r.data.data);
    },
  });

  // ── Net-worth query (all users, scoped to effectiveUserId) ────────────────────
  const { data: netWorth } = useQuery({
    queryKey: ['report-networth', viewUserId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (isAdmin && viewUserId) params.set('targetUserId', viewUserId);
      const qs = params.toString();
      return api.get<{ data: any }>(`/reports/net-worth-statement${qs ? `?${qs}` : ''}`).then((r) => r.data.data);
    },
  });

  // ── Trial Balance query — lazy: only fetches when tab is active ───────────────
  const { data: trialBalance, isLoading: isTBLoading, isError: isTBError, refetch: refetchTB } = useQuery({
    queryKey: ['trial-balance', selectedFY, viewUserId],
    queryFn: () => fetchTrialBalance(selectedFY, isAdmin ? viewUserId : undefined),
    enabled: activeTab === 'trialbalance',
  });

  const isLoading = isPnLLoading || (isAdmin && isMembersLoading);
  if (isLoading) return <PageLoader />;

  // ── P&L data ─────────────────────────────────────────────────────────────────
  const summary = plData?.summary;
  const monthly = plData?.monthly ?? [];
  const expenseCategories = plData?.expenseCategories ?? [];
  const incomeCategories = plData?.incomeCategories ?? [];
  const hasMonthlyData = monthly.some((m: any) => m.income > 0 || m.expense > 0);

  const expensePieData = expenseCategories.slice(0, 9).map((item: any, i: number) => ({
    name: item.categoryName,
    value: item.total,
    color: CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length],
  }));
  const expenseBarData = expenseCategories.slice(0, 15).map((item: any) => ({
    name: item.categoryName,
    amount: item.total,
  }));
  const incomePieData = incomeCategories.slice(0, 9).map((item: any, i: number) => ({
    name: item.categoryName,
    value: item.total,
    color: CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length],
  }));
  const incomeBarData = incomeCategories.slice(0, 15).map((item: any) => ({
    name: item.categoryName,
    amount: item.total,
  }));

  // ── Spending data ─────────────────────────────────────────────────────────────
  const spendingPieData = spendingByCat.slice(0, 9).map((item: any, i: number) => ({
    name: item.category?.name ?? 'Uncategorized',
    value: item.total,
    color: CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length],
  }));
  const spendingBarData = spendingByCat.slice(0, 15).map((item: any) => ({
    name: item.category?.name ?? 'Uncategorized',
    amount: item.total,
  }));

  // ── Scope label for subtitle ──────────────────────────────────────────────────
  const selectedMemberName = isAdmin && viewUserId
    ? members.find((m) => m.id === viewUserId)?.name ?? 'Member'
    : null;
  const scopeLabel = selectedMemberName
    ? `${selectedMemberName}'s data`
    : isAdmin
    ? 'Family-wide'
    : 'My data';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground text-sm mt-1">FY {selectedFY} · {scopeLabel}</p>
      </div>

      {/* Admin member selector — shared across all tabs */}
      {isAdmin && (
        <div className="flex items-center gap-2">
          <label htmlFor="reports-user-select" className="text-sm font-medium text-muted-foreground">View:</label>
          {isMembersError ? (
            <span className="text-xs text-destructive">Could not load members</span>
          ) : (
            <select
              id="reports-user-select"
              value={viewUserId ?? ''}
              onChange={(e) => setViewUserId(e.target.value || undefined)}
              className="rounded-md border bg-background px-3 py-1.5 text-sm"
            >
              <option value="">All Family</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── P&L Tab ──────────────────────────────────────────────────────────────── */}
      {activeTab === 'pl' && (
        <>
          {isPnLError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center space-y-3">
              <p className="text-sm font-medium text-destructive">Failed to load P&amp;L data</p>
              <p className="text-xs text-muted-foreground">Check that the backend is running and try again.</p>
              <button
                onClick={() => refetchPnL()}
                className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              {summary && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-xl border bg-card p-5 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Income</p>
                    <INRDisplay amount={summary.totalIncome} short className="text-2xl font-bold text-green-600 dark:text-green-400" />
                  </div>
                  <div className="rounded-xl border bg-card p-5 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Expenses</p>
                    <INRDisplay amount={summary.totalExpense} short className="text-2xl font-bold text-rose-600 dark:text-rose-400" />
                  </div>
                  <div className="rounded-xl border bg-card p-5 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Net Savings</p>
                    <INRDisplay amount={summary.netSavings} short colorCode className="text-2xl font-bold" />
                  </div>
                  <div className="rounded-xl border bg-card p-5 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Savings Rate</p>
                    <p className={`text-2xl font-bold tabular-nums ${summary.savingsRate >= 0 ? 'text-green-600 dark:text-green-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {summary.savingsRate.toFixed(1)}%
                    </p>
                  </div>
                </div>
              )}

              {/* Monthly trend */}
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Monthly Trend</h2>
                <div className="rounded-xl border bg-card p-4">
                  {!hasMonthlyData ? (
                    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                      No data for this financial year
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={monthly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <GradDefs />
                        <CartesianGrid {...GRID_STYLE} />
                        <XAxis dataKey="month" {...AXIS_STYLE} />
                        <YAxis tickFormatter={(v) => formatINRShort(v)} width={72} {...AXIS_STYLE} />
                        <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                        <Area type="natural" dataKey="income" name="Income" stroke={CHART_PALETTE.income} fill={`url(#${gradIds.income})`} strokeWidth={2} />
                        <Area type="natural" dataKey="expense" name="Expenses" stroke={CHART_PALETTE.expense} fill={`url(#${gradIds.expense})`} strokeWidth={2} />
                        <Area type="natural" dataKey="net" name="Net Savings" stroke={CHART_PALETTE.net} fill={`url(#${gradIds.net})`} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>

              {/* Expense breakdown */}
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Expense Breakdown</h2>
                {expenseCategories.length === 0 ? (
                  <div className="text-center py-8 border rounded-xl text-muted-foreground text-sm">
                    No expense data for this financial year
                  </div>
                ) : (
                  <div className="grid lg:grid-cols-2 gap-6">
                    <div className="rounded-xl border bg-card p-4">
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={expenseBarData} layout="vertical" margin={{ left: 80, top: 4, right: 8, bottom: 0 }}>
                          <CartesianGrid {...GRID_STYLE} horizontal={false} />
                          <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} {...AXIS_STYLE} />
                          <YAxis type="category" dataKey="name" width={75} {...AXIS_STYLE} />
                          <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                          <Bar dataKey="amount" name="Spent" fill={CHART_PALETTE.expense} radius={[0, 4, 4, 0]} animationDuration={600} animationEasing="ease-out" activeBar={{ fill: '#fb7185', radius: [0, 4, 4, 0] }} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-4">
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={expensePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={88} paddingAngle={2} strokeWidth={0} label={false}>
                            {expensePieData.map((_entry: any, i: number) => (
                              <Cell key={i} fill={CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {expenseCategories.map((item: any, i: number) => (
                          <div key={item.categoryId ?? i} className="flex items-center justify-between text-sm py-1 border-b border-muted last:border-0">
                            <div className="flex items-center gap-2">
                              <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length] }} />
                              <span>{item.categoryName}</span>
                            </div>
                            <INRDisplay amount={item.total} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Income sources */}
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Income Sources</h2>
                {incomeCategories.length === 0 ? (
                  <div className="text-center py-8 border rounded-xl text-muted-foreground text-sm">
                    No income data for this financial year
                  </div>
                ) : (
                  <div className="grid lg:grid-cols-2 gap-6">
                    <div className="rounded-xl border bg-card p-4">
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={incomeBarData} layout="vertical" margin={{ left: 80, top: 4, right: 8, bottom: 0 }}>
                          <CartesianGrid {...GRID_STYLE} horizontal={false} />
                          <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} {...AXIS_STYLE} />
                          <YAxis type="category" dataKey="name" width={75} {...AXIS_STYLE} />
                          <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                          <Bar dataKey="amount" name="Received" fill={CHART_PALETTE.income} radius={[0, 4, 4, 0]} animationDuration={600} animationEasing="ease-out" activeBar={{ fill: '#34d399', radius: [0, 4, 4, 0] }} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-4">
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={incomePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={88} paddingAngle={2} strokeWidth={0} label={false}>
                            {incomePieData.map((_entry: any, i: number) => (
                              <Cell key={i} fill={CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {incomeCategories.map((item: any, i: number) => (
                          <div key={item.categoryId ?? i} className="flex items-center justify-between text-sm py-1 border-b border-muted last:border-0">
                            <div className="flex items-center gap-2">
                              <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length] }} />
                              <span>{item.categoryName}</span>
                            </div>
                            <INRDisplay amount={item.total} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}

      {/* ── Spending Analysis Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'spending' && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Spending by Category — FY {selectedFY}</h2>
          {spendingByCat.length === 0 ? (
            <div className="text-center py-8 border rounded-lg text-muted-foreground">No spending data for this FY</div>
          ) : (
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="rounded-lg border bg-card p-4">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={spendingBarData} layout="vertical" margin={{ left: 80, top: 4, right: 8, bottom: 0 }}>
                    <CartesianGrid {...GRID_STYLE} horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} {...AXIS_STYLE} />
                    <YAxis type="category" dataKey="name" width={75} {...AXIS_STYLE} />
                    <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                    <Bar dataKey="amount" name="Spent" fill={CHART_PALETTE.expense} radius={[0, 4, 4, 0]} animationDuration={600} animationEasing="ease-out" activeBar={{ fill: '#fb7185', radius: [0, 4, 4, 0] }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-4">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={spendingPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={88} paddingAngle={2} strokeWidth={0} label={false}>
                      {spendingPieData.map((entry: any, i: number) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {spendingByCat.map((item: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-muted last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length] }} />
                        <span>{item.category?.name ?? 'Uncategorized'}</span>
                      </div>
                      <INRDisplay amount={item.total} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Trial Balance Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'trialbalance' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Trial Balance — FY {selectedFY}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Income and expense accounts for the financial year. Total debits always equal total credits.
            </p>
          </div>

          {isTBError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center space-y-3">
              <p className="text-sm font-medium text-destructive">Failed to load Trial Balance</p>
              <p className="text-xs text-muted-foreground">Check that the backend is running and try again.</p>
              <button
                onClick={() => refetchTB()}
                className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Retry
              </button>
            </div>
          ) : isTBLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Loading trial balance…
            </div>
          ) : !trialBalance || trialBalance.entries.length === 0 ? (
            <div className="text-center py-8 border rounded-xl text-muted-foreground text-sm">
              No transactions for this financial year
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl border bg-card p-5 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Income</p>
                  <INRDisplay amount={trialBalance.totals.rawTotalIncome} short className="text-2xl font-bold text-green-600 dark:text-green-400" />
                </div>
                <div className="rounded-xl border bg-card p-5 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Expenses</p>
                  <INRDisplay amount={trialBalance.totals.rawTotalExpenses} short className="text-2xl font-bold text-rose-600 dark:text-rose-400" />
                </div>
                <div className="rounded-xl border bg-card p-5 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Net Savings</p>
                  <INRDisplay amount={trialBalance.totals.netSavings} short colorCode className="text-2xl font-bold" />
                </div>
              </div>

              {/* Trial balance table */}
              <div className="rounded-xl border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Account Name</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground w-40">Debit (₹)</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground w-40">Credit (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trialBalance.entries.map((entry) => {
                      const isBalancingRow = entry.accountName === 'Net Savings (Surplus)' || entry.accountName === 'Net Loss (Deficit)';
                      return (
                        <tr
                          key={`${entry.type}-${entry.accountName}`}
                          className={cn(
                            'border-b last:border-0 transition-colors',
                            isBalancingRow
                              ? 'bg-muted/30 italic text-muted-foreground'
                              : 'hover:bg-muted/20',
                          )}
                        >
                          <td className="px-4 py-2.5">{entry.accountName}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {entry.debit > 0 ? <INRDisplay amount={entry.debit} /> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {entry.credit > 0 ? <INRDisplay amount={entry.credit} /> : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 bg-muted/50">
                      <td className="px-4 py-3 font-semibold">Total</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        <INRDisplay amount={trialBalance.totals.totalDebits} />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        <INRDisplay amount={trialBalance.totals.totalCredits} />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── Net Worth Tab ─────────────────────────────────────────────────────────── */}
      {activeTab === 'networth' && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Net Worth Statement</h2>
          {!netWorth ? (
            <div className="text-center py-8 border rounded-lg text-muted-foreground">Loading net worth data...</div>
          ) : (
            <div className="grid md:grid-cols-3 gap-4">
              <div className="md:col-span-1 rounded-lg border bg-card p-5 space-y-4">
                <h3 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">Assets</h3>
                {/* Accounts */}
                {Array.isArray(netWorth.bankAccounts) && netWorth.bankAccounts.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Accounts</p>
                    {netWorth.bankAccounts.map((acct: { bankName: string; accountNumberLast4: string | null; accountType: string; currentBalance: number }, i: number) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="truncate pr-2">
                          {acct.bankName}
                          {acct.accountNumberLast4 ? ` ···${acct.accountNumberLast4}` : ''}
                          <span className="text-muted-foreground ml-1 capitalize">({acct.accountType.toLowerCase()})</span>
                        </span>
                        <INRDisplay amount={acct.currentBalance} />
                      </div>
                    ))}
                  </div>
                )}
                {/* Fixed Deposits */}
                {Array.isArray(netWorth.fdItems) && netWorth.fdItems.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fixed Deposits</p>
                    {netWorth.fdItems.map((fd: { bankName: string; amount: number }, i: number) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="truncate pr-2">{fd.bankName}</span>
                        <INRDisplay amount={fd.amount} />
                      </div>
                    ))}
                  </div>
                )}
                {/* Recurring Deposits */}
                {Array.isArray(netWorth.rdItems) && netWorth.rdItems.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recurring Deposits</p>
                    {netWorth.rdItems.map((rd: { bankName: string; amount: number }, i: number) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="truncate pr-2">{rd.bankName}</span>
                        <INRDisplay amount={rd.amount} />
                      </div>
                    ))}
                  </div>
                )}
                {/* Investments */}
                {Array.isArray(netWorth.investmentItems) && netWorth.investmentItems.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Investments</p>
                    {netWorth.investmentItems.map((inv: { name: string; type: string; amount: number }, i: number) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="truncate pr-2">
                          {inv.name}
                          <span className="text-muted-foreground ml-1">({INVESTMENT_TYPE_LABELS[inv.type] ?? inv.type})</span>
                        </span>
                        <INRDisplay amount={inv.amount} />
                      </div>
                    ))}
                  </div>
                )}
                {/* Gold */}
                {Array.isArray(netWorth.goldItems) && netWorth.goldItems.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Gold</p>
                    {netWorth.goldItems.map((g: { type: string; description: string | null; amount: number }, i: number) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="truncate pr-2">
                          {GOLD_TYPE_LABELS[g.type] ?? g.type}
                          {g.description ? ` — ${g.description}` : ''}
                        </span>
                        <INRDisplay amount={g.amount} />
                      </div>
                    ))}
                  </div>
                )}
                {/* Real Estate */}
                {Array.isArray(netWorth.realEstateItems) && netWorth.realEstateItems.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Real Estate</p>
                    {netWorth.realEstateItems.map((p: { propertyName: string; propertyType: string; amount: number }, i: number) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="truncate pr-2">{p.propertyName}</span>
                        <INRDisplay amount={p.amount} />
                      </div>
                    ))}
                  </div>
                )}
                {/* Fallback: no accounts and no other assets */}
                {(!Array.isArray(netWorth.bankAccounts) || netWorth.bankAccounts.length === 0) && netWorth.assets.bankBalances > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Accounts</p>
                    <div className="flex justify-between text-sm">
                      <span>Bank Balances</span>
                      <INRDisplay amount={netWorth.assets.bankBalances} />
                    </div>
                  </div>
                )}
                <div className="border-t pt-2 flex justify-between font-semibold">
                  <span>Total Assets</span>
                  <INRDisplay amount={netWorth.totalAssets} />
                </div>
              </div>
              <div className="rounded-lg border bg-card p-5 space-y-4">
                <h3 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">Liabilities</h3>
                {Object.keys(netWorth.liabilities).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active loans</p>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Loans</p>
                    {Object.entries(netWorth.liabilities).map(([type, amt]) => (
                      <div key={type} className="flex justify-between text-sm">
                        <span>{LOAN_TYPE_LABELS[type] ?? type}</span>
                        <INRDisplay amount={amt as number} />
                      </div>
                    ))}
                  </div>
                )}
                <div className="border-t pt-2 flex justify-between font-semibold">
                  <span>Total Liabilities</span>
                  <INRDisplay amount={netWorth.totalLiabilities} />
                </div>
              </div>
              <div className="rounded-lg border bg-card p-5 flex flex-col items-center justify-center text-center">
                <p className="text-sm text-muted-foreground">Net Worth</p>
                <INRDisplay amount={netWorth.netWorth} short className="text-4xl font-bold mt-2" />
                <p className="text-sm text-muted-foreground mt-2">Assets − Liabilities</p>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
