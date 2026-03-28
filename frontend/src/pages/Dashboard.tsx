import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, ArrowUpRight, Bell, Target } from 'lucide-react';
import { useFY } from '@/contexts/FYContext';
import { fetchDashboardSummary, fetchCashflow, fetchUpcomingAlerts } from '@/api/dashboard';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { formatINRShort } from '@/lib/indianFormat';
import { cn } from '@/lib/utils';
import { useBudgetsVsActuals } from '@/hooks/useBudgetsVsActuals';
import { Link } from 'react-router-dom';

// Indian-palette chart colors (saffron/green/navy)
const CHART_COLORS = {
  income: '#138808',  // India green
  expense: '#FF9933', // Saffron
  net: '#000080',     // Navy
};

export default function DashboardPage() {
  const { selectedFY } = useFY();

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['dashboard', 'summary', selectedFY],
    queryFn: () => fetchDashboardSummary(selectedFY),
  });

  const { data: cashflow, isLoading: cashflowLoading } = useQuery({
    queryKey: ['dashboard', 'cashflow', selectedFY],
    queryFn: () => fetchCashflow(selectedFY),
  });

  const { data: alerts } = useQuery({
    queryKey: ['dashboard', 'alerts'],
    queryFn: fetchUpcomingAlerts,
  });

  const { data: budgetActuals } = useBudgetsVsActuals(selectedFY);

  if (summaryLoading) return <PageLoader />;

  const savingsRateClass =
    (summary?.savingsRate ?? 0) > 30
      ? 'text-green-600'
      : (summary?.savingsRate ?? 0) > 10
      ? 'text-yellow-600'
      : 'text-red-600';

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Financial overview for FY {selectedFY}</p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Net Worth */}
        <StatCard
          title="Net Worth"
          value={summary?.netWorth ?? 0}
          change={summary?.netWorthChangePct}
          subtitle="vs last FY"
        />
        {/* Income */}
        <StatCard
          title="Total Income"
          value={summary?.totalIncome ?? 0}
          positive
        />
        {/* Expense */}
        <StatCard
          title="Total Expense"
          value={summary?.totalExpense ?? 0}
          negative
        />
        {/* Savings Rate */}
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium text-muted-foreground">Savings Rate</p>
          <p className={cn('mt-1 text-2xl font-bold', savingsRateClass)}>
            {(summary?.savingsRate ?? 0).toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-muted-foreground">This FY</p>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Cash Flow chart (spans 2 cols) */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Cash Flow — FY {selectedFY}</h2>
          {cashflowLoading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-pulse text-muted-foreground">Loading chart...</div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={cashflow} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12 }}
                  className="text-muted-foreground"
                />
                <YAxis
                  tickFormatter={(v) => formatINRShort(v)}
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                  width={70}
                />
                <Tooltip
                  formatter={(value: number) => formatINRShort(value)}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Bar dataKey="income" name="Income" fill={CHART_COLORS.income} radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name="Expense" fill={CHART_COLORS.expense} radius={[3, 3, 0, 0]} />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Asset split (simplified placeholder) */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Assets vs Liabilities</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={[
                  { name: 'Assets', value: summary?.totalAssets ?? 0 },
                  { name: 'Liabilities', value: summary?.totalLiabilities ?? 0 },
                ]}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                dataKey="value"
              >
                <Cell fill={CHART_COLORS.income} />
                <Cell fill={CHART_COLORS.expense} />
              </Pie>
              <Tooltip formatter={(v: number) => formatINRShort(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 text-center">
            <p className="text-sm text-muted-foreground">Net Worth</p>
            <INRDisplay amount={summary?.netWorth ?? 0} short className="text-lg font-bold" />
          </div>
        </div>
      </div>

      {/* Upcoming alerts */}
      {alerts && alerts.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Upcoming This Month</h2>
          </div>
          <div className="space-y-2">
            {alerts.slice(0, 5).map((alert) => (
              <div
                key={alert.entityId}
                className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {alert.daysUntilDue === 0
                      ? 'Due today'
                      : alert.daysUntilDue === 1
                      ? 'Due tomorrow'
                      : `Due in ${alert.daysUntilDue} days`}
                  </p>
                </div>
                {alert.amount && (
                  <INRDisplay amount={alert.amount} short className="text-sm font-semibold" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Budget Health */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Budget Health</h2>
          </div>
          <Link to="/budgets" className="text-xs text-muted-foreground hover:underline flex items-center gap-1">
            View all <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>

        {/* Only show FY-period budgets — MONTHLY/QUARTERLY budgets vs FY actuals would give misleading percentages */}
        {(() => {
          const fyBudgets = (budgetActuals ?? []).filter((b) => b.period === 'FY');
          return fyBudgets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No FY budgets configured.{' '}
            <Link to="/budgets" className="underline hover:text-foreground">
              Set up FY budgets
            </Link>{' '}
            to track annual spending here.
          </p>
        ) : (
          <div className="space-y-3">
            {fyBudgets.slice(0, 6).map((b) => {
              const pct = Math.min(b.pctUsed, 100);
              const barColor =
                b.pctUsed >= 100
                  ? 'bg-red-500'
                  : b.pctUsed >= 75
                  ? 'bg-yellow-500'
                  : 'bg-green-500';
              return (
                <div key={b.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{b.category.name}</span>
                    <span className="text-xs text-muted-foreground">
                      <INRDisplay amount={b.actual} short className="inline" /> /{' '}
                      <INRDisplay amount={Number(b.amount)} short className="inline" />
                      <span
                        className={cn(
                          'ml-1 font-semibold',
                          b.pctUsed >= 100 ? 'text-red-600' : b.pctUsed >= 75 ? 'text-yellow-600' : 'text-green-600',
                        )}
                      >
                        ({b.pctUsed.toFixed(0)}%)
                      </span>
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn('h-2 rounded-full transition-all', barColor)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
        })()}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  change,
  subtitle,
  positive,
  negative,
}: {
  title: string;
  value: number;
  change?: number;
  subtitle?: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const isPositive = change !== undefined && change >= 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <INRDisplay
        amount={value}
        short
        className="mt-1 text-2xl font-bold block"
        positive={positive}
        negative={negative}
      />
      {change !== undefined && (
        <div className={cn('mt-1 flex items-center gap-1 text-xs', isPositive ? 'text-green-600' : 'text-red-600')}>
          {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span>{Math.abs(change).toFixed(1)}% {subtitle}</span>
        </div>
      )}
    </div>
  );
}
