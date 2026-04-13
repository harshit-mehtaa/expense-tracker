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
import { useAuth } from '@/contexts/AuthContext';
import { fetchProfitAndLoss } from '@/api/dashboard';
import api from '@/lib/api';
import { formatINRShort } from '@/lib/indianFormat';
import { cn } from '@/lib/utils';
import {
  useChartGradients,
  CHART_PALETTE,
  CustomTooltip,
  AXIS_STYLE,
  GRID_STYLE,
} from '@/lib/chartUtils';

type TabId = 'pl' | 'spending' | 'networth';

export default function ReportsPage() {
  const { selectedFY } = useFY();
  const { user } = useAuth();
  const { gradIds, GradDefs } = useChartGradients();
  const isAdmin = user?.role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<TabId>('pl');
  const [viewUserId, setViewUserId] = useState<string | undefined>(undefined);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'pl', label: 'P&L' },
    ...(isAdmin ? [{ id: 'spending' as TabId, label: 'Spending Analysis' }] : []),
    ...(isAdmin ? [{ id: 'networth' as TabId, label: 'Net Worth' }] : []),
  ];

  // P&L queries (all users)
  const { data: members = [], isLoading: isMembersLoading, isError: isMembersError } = useQuery<{ id: string; name: string; isActive: boolean }[]>({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ data: { id: string; name: string; isActive: boolean }[] }>('/admin/users').then((r) => r.data.data),
    enabled: isAdmin,
  });

  const { data: plData, isLoading: isPnLLoading, isError: isPnLError, refetch: refetchPnL } = useQuery({
    queryKey: ['profit-and-loss', selectedFY, viewUserId],
    queryFn: () => fetchProfitAndLoss(selectedFY, viewUserId),
  });

  // Admin-only queries
  const { data: spendingByCat = [] } = useQuery({
    queryKey: ['report-spending', selectedFY],
    queryFn: () => api.get<{ data: any[] }>(`/reports/spending-by-category?fy=${selectedFY}`).then((r) => r.data.data),
    enabled: isAdmin,
  });

  const { data: netWorth } = useQuery({
    queryKey: ['report-networth'],
    queryFn: () => api.get<{ data: any }>('/reports/net-worth-statement').then((r) => r.data.data),
    enabled: isAdmin,
  });

  const isLoading = isPnLLoading || (isAdmin && isMembersLoading);
  if (isLoading) return <PageLoader />;

  // P&L data
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

  // Spending analysis data
  const spendingPieData = spendingByCat.slice(0, 9).map((item: any, i: number) => ({
    name: item.category?.name ?? 'Uncategorized',
    value: item.total,
    color: CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length],
  }));
  const spendingBarData = spendingByCat.slice(0, 15).map((item: any) => ({
    name: item.category?.name ?? 'Uncategorized',
    amount: item.total,
  }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground text-sm mt-1">FY {selectedFY}</p>
      </div>

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

      {/* ── P&L Tab ─────────────────────────────────────────────────────────── */}
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
              {/* Admin member selector */}
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <label htmlFor="pnl-user-select" className="text-sm font-medium text-muted-foreground">View:</label>
                  {isMembersError ? (
                    <span className="text-xs text-destructive">Could not load members</span>
                  ) : (
                    <select
                      id="pnl-user-select"
                      value={viewUserId ?? ''}
                      onChange={(e) => setViewUserId(e.target.value || undefined)}
                      className="rounded-md border bg-background px-3 py-1.5 text-sm"
                    >
                      <option value="">All Family</option>
                      {members.filter((m) => m.isActive).map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

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

      {/* ── Spending Analysis Tab (admin only) ───────────────────────────────── */}
      {activeTab === 'spending' && isAdmin && (
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

      {/* ── Net Worth Tab (admin only) ────────────────────────────────────────── */}
      {activeTab === 'networth' && isAdmin && netWorth && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Net Worth Statement</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-1 rounded-lg border bg-card p-5 space-y-3">
              <h3 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">Assets</h3>
              {Object.entries(netWorth.assets).map(([key, val]) => {
                const labels: Record<string, string> = {
                  bankBalances: 'Bank Balances', fixedDeposits: 'Fixed Deposits',
                  recurringDeposits: 'Recurring Deposits', investments: 'Investments',
                  gold: 'Gold', realEstate: 'Real Estate',
                };
                return (
                  <div key={key} className="flex justify-between text-sm">
                    <span>{labels[key] ?? key}</span>
                    <INRDisplay amount={val as number} />
                  </div>
                );
              })}
              <div className="border-t pt-2 flex justify-between font-semibold">
                <span>Total Assets</span>
                <INRDisplay amount={netWorth.totalAssets} />
              </div>
            </div>
            <div className="rounded-lg border bg-card p-5 space-y-3">
              <h3 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">Liabilities</h3>
              <div className="flex justify-between text-sm">
                <span>Loans Outstanding</span>
                <INRDisplay amount={netWorth.liabilities.loans} />
              </div>
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
        </section>
      )}
    </div>
  );
}
