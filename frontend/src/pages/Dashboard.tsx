import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Legend,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { CHART_PALETTE, useChartGradients, CustomTooltip, AXIS_STYLE, GRID_STYLE } from '@/lib/chartUtils';
import { TrendingUp, TrendingDown, ArrowUpRight, Bell, Target, Users } from 'lucide-react';
import { useFY } from '@/contexts/FYContext';
import { fetchDashboardSummary, fetchCashflow, fetchUpcomingAlerts, fetchNetWorthHistory, upsertNetWorthSnapshot, fetchFamilyOverview } from '@/api/dashboard';
import { useAuth } from '@/contexts/AuthContext';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { formatINRShort } from '@/lib/indianFormat';
import { cn } from '@/lib/utils';
import { useBudgetsVsActuals } from '@/hooks/useBudgetsVsActuals';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import { Link, useNavigate } from 'react-router-dom';


export default function DashboardPage() {
  const { selectedFY } = useFY();
  const { user } = useAuth();
  const { gradIds, GradDefs } = useChartGradients();
  const navigate = useNavigate();
  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['dashboard', 'summary', selectedFY, viewUserId],
    queryFn: () => fetchDashboardSummary(selectedFY, viewUserId),
  });

  const { data: cashflow, isLoading: cashflowLoading } = useQuery({
    queryKey: ['dashboard', 'cashflow', selectedFY, viewUserId],
    queryFn: () => fetchCashflow(selectedFY, viewUserId),
  });

  const { data: alerts } = useQuery({
    queryKey: ['dashboard', 'alerts', viewUserId],
    queryFn: () => fetchUpcomingAlerts(viewUserId),
  });

  const { data: budgetActuals } = useBudgetsVsActuals(selectedFY, viewUserId);

  const { data: familyOverview } = useQuery({
    queryKey: ['dashboard', 'family-overview', selectedFY],
    queryFn: () => fetchFamilyOverview(selectedFY),
    enabled: user?.role === 'ADMIN',
  });

  const queryClient = useQueryClient();
  const { data: netWorthHistory } = useQuery({
    queryKey: ['net-worth-history'],
    queryFn: fetchNetWorthHistory,
  });
  // Fire upsert only if the current month snapshot is absent — avoids write-on-read on every load
  const { mutate: triggerSnapshot } = useMutation({
    mutationFn: upsertNetWorthSnapshot,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['net-worth-history'] }),
  });
  const currentMonthKey = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const hasCurrentMonthSnapshot = netWorthHistory?.some(
    (s) => s.snapshotDate.slice(0, 7) === currentMonthKey,
  );
  // Fire upsert in an effect (not render body) to avoid React side-effect violations
  useEffect(() => {
    if (netWorthHistory !== undefined && !hasCurrentMonthSnapshot) {
      triggerSnapshot();
    }
  }, [netWorthHistory, hasCurrentMonthSnapshot]); // triggerSnapshot is stable from useMutation

  const netWorthChartData = (netWorthHistory ?? []).slice(-12).map((s) => ({
    month: new Date(s.snapshotDate).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    netWorth: Number(s.netWorth ?? 0),
  }));

  if (summaryLoading || (isAdmin && isMembersLoading)) return <PageLoader />;

  const savingsRate = summary?.savingsRate ?? 0;
  const savingsScheme = savingsRate > 30 ? 'emerald' : savingsRate > 10 ? 'amber' : 'rose';

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Financial overview for FY {selectedFY}
          {isAdmin && viewUserId
            ? ` · ${members.find((m) => m.id === viewUserId)?.name ?? 'Member'}`
            : isAdmin ? ' · All Family' : ''}
        </p>
        {isAdmin && (
          <div className="flex items-center gap-2 mt-3">
            <label htmlFor="dashboard-member-select" className="text-sm font-medium text-muted-foreground">View:</label>
            {isMembersError ? (
              <span className="text-xs text-destructive">Could not load members</span>
            ) : (
              <select
                id="dashboard-member-select"
                value={viewUserId ?? ''}
                onChange={(e) => setViewUserId(e.target.value || undefined)}
                className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All Family</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Net Worth — indigo */}
        <StatCard
          title="Net Worth"
          value={summary?.netWorth ?? 0}
          change={summary?.netWorthChangePct}
          subtitle="vs last FY"
          colorScheme="indigo"
        />
        {/* Income — emerald */}
        <StatCard
          title="Total Income"
          value={summary?.totalIncome ?? 0}
          colorScheme="emerald"
        />
        {/* Expense — rose */}
        <StatCard
          title="Total Expense"
          value={summary?.totalExpense ?? 0}
          colorScheme="rose"
        />
        {/* Savings Rate — color based on health */}
        <StatCard
          title="Savings Rate"
          valueStr={`${savingsRate.toFixed(1)}%`}
          subtitle="This FY"
          colorScheme={savingsScheme}
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Cash Flow chart (spans 2 cols) */}
        <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card shadow-card p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold">Cash Flow — FY {selectedFY}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Click any month to view transactions</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_PALETTE.income }} />
                Income
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_PALETTE.expense }} />
                Expense
              </span>
            </div>
          </div>
          {cashflowLoading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-pulse text-muted-foreground">Loading chart...</div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart
                data={cashflow}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                style={{ cursor: 'pointer' }}
                onClick={(chartData) => {
                  if (!chartData?.activePayload?.[0]) return;
                  const monthLabel: string = chartData.activePayload[0].payload.month; // e.g. "Apr '24"
                  // Parse "MMM 'YY" → derive startDate/endDate for that month
                  const [mon, yr] = monthLabel.split(' ');
                  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                  const monthIdx = months.indexOf(mon);
                  const fullYear = 2000 + parseInt(yr.replace("'", ''), 10);
                  const start = new Date(fullYear, monthIdx, 1);
                  const end = new Date(fullYear, monthIdx + 1, 0);
                  const fmt = (d: Date) => d.toISOString().slice(0, 10);
                  navigate(`/transactions?startDate=${fmt(start)}&endDate=${fmt(end)}`);
                }}
              >
                <GradDefs />
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="month" {...AXIS_STYLE} />
                <YAxis
                  tickFormatter={(v) => formatINRShort(v)}
                  width={70}
                  {...AXIS_STYLE}
                />
                <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                <Area
                  type="natural"
                  dataKey="income"
                  name="Income"
                  stroke={CHART_PALETTE.income}
                  fill={`url(#${gradIds.income})`}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: 'rgba(255,255,255,0.7)' }}
                />
                <Area
                  type="natural"
                  dataKey="expense"
                  name="Expense"
                  stroke={CHART_PALETTE.expense}
                  fill={`url(#${gradIds.expense})`}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: 'rgba(255,255,255,0.7)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Asset split (simplified placeholder) */}
        <div className="rounded-xl border border-border/60 bg-card shadow-card p-4">
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
                innerRadius={52}
                outerRadius={88}
                dataKey="value"
                paddingAngle={2}
                strokeWidth={0}
              >
                <Cell fill={CHART_PALETTE.income} />
                <Cell fill={CHART_PALETTE.expense} />
              </Pie>
              <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
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
        <div className="rounded-xl border border-border/60 bg-card shadow-card p-4">
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
      <div className="rounded-xl border border-border/60 bg-card shadow-card p-4">
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
              const barGradient =
                b.pctUsed >= 100
                  ? 'linear-gradient(90deg, #f43f5e, #fb7185)'
                  : b.pctUsed >= 75
                  ? 'linear-gradient(90deg, #f59e0b, #fcd34d)'
                  : 'linear-gradient(90deg, #10b981, #6ee7b7)';
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
                      className="h-2 rounded-full transition-all"
                      style={{ width: `${pct}%`, background: barGradient }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
        })()}
      </div>

      {/* Net Worth Trend */}
      {netWorthChartData.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card shadow-card p-4">
          <div className="mb-3">
            <h2 className="text-base font-semibold">Net Worth Trend</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Monthly snapshots — based on data at time of capture</p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={netWorthChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <GradDefs />
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="month" {...AXIS_STYLE} />
              <YAxis tickFormatter={(v) => formatINRShort(v)} width={70} {...AXIS_STYLE} />
              <Tooltip content={<CustomTooltip formatter={(v) => formatINRShort(v)} />} />
              <Area
                type="natural"
                dataKey="netWorth"
                name="Net Worth"
                stroke={CHART_PALETTE.net}
                fill={`url(#${gradIds.net})`}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: 'rgba(255,255,255,0.7)' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Family spending breakdown — admin only */}
      {user?.role === 'ADMIN' && familyOverview && familyOverview.members.length > 1 && (
        <div className="rounded-xl border border-border/60 bg-card shadow-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Family Spending — FY {selectedFY}</h2>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={familyOverview.chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="month" {...AXIS_STYLE} />
              <YAxis tickFormatter={(v) => formatINRShort(v)} width={70} {...AXIS_STYLE} />
              <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {familyOverview.members.map((member) => (
                <Bar key={member.id} dataKey={member.id} name={member.name} stackId="members" fill={member.colorTag} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

const COLOR_SCHEMES = {
  indigo: {
    bg: 'bg-indigo-50 dark:bg-indigo-950/40',
    border: 'border-indigo-100 dark:border-indigo-900/50',
    icon: 'bg-indigo-500',
    value: 'text-indigo-700 dark:text-indigo-300',
    label: 'text-indigo-600/80 dark:text-indigo-400/80',
    trend: { up: 'text-emerald-600', down: 'text-red-500' },
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    border: 'border-emerald-100 dark:border-emerald-900/50',
    icon: 'bg-emerald-500',
    value: 'text-emerald-700 dark:text-emerald-300',
    label: 'text-emerald-600/80 dark:text-emerald-400/80',
    trend: { up: 'text-emerald-600', down: 'text-red-500' },
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    border: 'border-rose-100 dark:border-rose-900/50',
    icon: 'bg-rose-500',
    value: 'text-rose-700 dark:text-rose-300',
    label: 'text-rose-600/80 dark:text-rose-400/80',
    trend: { up: 'text-green-600', down: 'text-rose-600' },
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    border: 'border-amber-100 dark:border-amber-900/50',
    icon: 'bg-amber-500',
    value: 'text-amber-700 dark:text-amber-300',
    label: 'text-amber-600/80 dark:text-amber-400/80',
    trend: { up: 'text-amber-600', down: 'text-amber-600' },
  },
} as const;

type ColorScheme = keyof typeof COLOR_SCHEMES;

function StatCard({
  title,
  value,
  valueStr,
  change,
  subtitle,
  colorScheme = 'indigo',
}: {
  title: string;
  value?: number;
  valueStr?: string;
  change?: number;
  subtitle?: string;
  colorScheme?: ColorScheme;
}) {
  const c = COLOR_SCHEMES[colorScheme];
  const isPositive = change !== undefined && change >= 0;

  return (
    <div className={cn('rounded-xl border p-5 transition-shadow hover:shadow-card', c.bg, c.border)}>
      <p className={cn('text-xs font-semibold uppercase tracking-wider', c.label)}>{title}</p>
      {value !== undefined ? (
        <INRDisplay
          amount={value}
          short
          className={cn('mt-2 text-2xl font-bold block', c.value)}
        />
      ) : (
        <p className={cn('mt-2 text-2xl font-bold', c.value)}>{valueStr}</p>
      )}
      {change !== undefined && (
        <div className={cn('mt-1.5 flex items-center gap-1 text-xs font-medium', isPositive ? c.trend.up : c.trend.down)}>
          {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span>{Math.abs(change).toFixed(1)}% {subtitle}</span>
        </div>
      )}
      {subtitle && change === undefined && (
        <p className={cn('mt-1.5 text-xs', c.label)}>{subtitle}</p>
      )}
    </div>
  );
}
